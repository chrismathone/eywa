"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import type { WithdrawalMetadata } from "@/features/withdrawals/types";

export type MergeStudentsState =
  | { error?: string; mergedRows?: number }
  | undefined;

/**
 * 두 학생 병합. keeperId가 살아남고, mergeeId의 데이터를 모두 keeperId로 이전.
 * 이전 대상: enrollments, attendance_records, invoices, student_consultations,
 *           student_grades, student_memos, enrollment_consultations(linked).
 * mergee는 soft delete (status='withdrawn' + withdrawn_at=today + 메모로 마킹).
 */
export async function mergeStudents(
  _prev: MergeStudentsState,
  formData: FormData,
): Promise<MergeStudentsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const keeperId = String(formData.get("keeperId") ?? "").trim();
  const mergeeId = String(formData.get("mergeeId") ?? "").trim();
  if (!keeperId || !mergeeId || keeperId === mergeeId) {
    return { error: "유효한 두 학생을 선택해주세요" };
  }

  const supabase = await createClient();
  let mergedRows = 0;

  // 감사 기록용 이름 선조회 — mergee는 곧 퇴원 마킹되므로 병합 시점 이름을 보존한다.
  const { data: pairNames } = await supabase
    .from("students")
    .select("id, name")
    .in("id", [keeperId, mergeeId]);
  const mergeeName = (pairNames ?? []).find((s) => s.id === mergeeId)?.name ?? null;

  const tables = [
    "enrollments",
    "attendance_records",
    "invoices",
    "student_consultations",
    "student_grades",
    "student_memos",
  ];
  for (const table of tables) {
    const { error, count } = await supabase
      .from(table)
      .update({ student_id: keeperId }, { count: "exact" })
      .eq("student_id", mergeeId);
    if (error) return { error: `${table}: ${error.message}` };
    mergedRows += count ?? 0;
  }

  // enrollment_consultations.linked_student_id
  await supabase
    .from("enrollment_consultations")
    .update({ student_id: keeperId })
    .eq("student_id", mergeeId);

  // mergee soft delete
  const today = kstToday();
  await supabase
    .from("students")
    .update({
      status: "withdrawn",
      withdrawn_at: today,
      notes: `중복 병합: ${keeperId}와 통합됨 (${today})`,
      dup_suspect: false,
    })
    .eq("id", mergeeId);

  // 🔴 살아남은 쪽의 '의심' 표식도 내린다 — 안 내리면 keeper가 접미사 학생일 때(예: `권민서B`를 보존)
  //    상세 배너는 계속 *"중복 병합으로 합치세요"* 라고 하는데 짝은 이미 퇴원해 후보가 0건이라,
  //    원장이 제보한 "합칠 곳이 없음"이 병합 직후에 그대로 재현된다. 병합 = 사람이 답을 낸 것이다.
  await supabase.from("students").update({ dup_suspect: false }).eq("id", keeperId);

  await logAction({
    action: "student_merge",
    targetType: "student",
    metadata: { studentId: keeperId, mergedStudentId: mergeeId, mergedName: mergeeName, mergedRows },
  });

  // 중복 병합 UI는 /owner?tab=data(데이터 정리 면)에 있다 — 그 경로를 revalidate해야 병합 후 목록이
  // 자동 갱신된다(구 /admin/duplicates는 redirect stub이라 무의미했음). /students도 함께(mergee 퇴원).
  revalidatePath("/owner");
  revalidatePath("/students");
  return { mergedRows };
}

export type CleanupState = { error?: string; closedCount?: number } | undefined;

/** withdrawn 학생의 활성 enrollment 강제 종료. */
export async function closeOrphanEnrollments(
  _prev: CleanupState,
  _formData: FormData,
): Promise<CleanupState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const supabase = await createClient();
  const today = kstToday();

  // 퇴원 학생은 누적 증가(>1000 가능) → 무페이징 select는 silent 절단 → fetchAllPaged(B2).
  const withdrawnStudents = await fetchAllPaged<{ id: string }>((from, to) =>
    supabase.from("students").select("id").eq("status", "withdrawn").range(from, to),
  );
  const ids = withdrawnStudents.map((s) => s.id);
  if (ids.length === 0) return { closedCount: 0 };

  // 대량 .in()은 100개 청크로 분할(URL 414 방지, B3). 청크별 count 합산.
  // ⚠️ 종료일 = max(start_date, 오늘)로 클램프 — 미래 시작(배정 예정) 수강에 end_date=today를 넣으면
  //    daterange(start_date, today)가 lower>upper로 throw("range lower bound must be less than or equal
  //    to range upper bound"). 미래 시작 건은 end_date=start_date(zero-length=미활성=사실상 취소, run.ts 유령수강 픽스와 동일).
  let closedCount = 0;
  for (const part of chunkIds(ids)) {
    // 정상(시작일 ≤ 오늘): end_date = 오늘 (한 번에).
    const { error, count } = await supabase
      .from("enrollments")
      .update(
        { end_date: today, withdrawal_reason: "퇴원에 따른 자동 종료" },
        { count: "exact" },
      )
      .in("student_id", part)
      .is("end_date", null)
      .lte("start_date", today);
    if (error) return { error: error.message };
    closedCount += count ?? 0;

    // 미래 시작(배정 예정): 행마다 start_date가 달라 개별 종료(end_date = 그 수강의 start_date).
    const { data: future, error: fErr } = await supabase
      .from("enrollments")
      .select("id, start_date")
      .in("student_id", part)
      .is("end_date", null)
      .gt("start_date", today);
    if (fErr) return { error: fErr.message };
    for (const e of future ?? []) {
      const { error: uErr } = await supabase
        .from("enrollments")
        .update({ end_date: e.start_date, withdrawal_reason: "퇴원에 따른 자동 종료" })
        .eq("id", e.id);
      if (uErr) return { error: uErr.message };
      closedCount += 1;
    }
  }

  revalidatePath("/admin/cleanup");
  return { closedCount };
}

// === 데이터 정리: 수강 없는 재원생 일괄 처리 (퇴원/삭제) ===

export type BulkStudentState = { error?: string; ok?: true; message?: string } | undefined;

/** 큰 .in()을 100개 청크로 분할 (B3 — URL 414 방지). */
function chunkIds(ids: string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

function parseSelectedIds(formData: FormData): string[] {
  return String(formData.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 선택한 학생들을 일괄 퇴원 처리(상태=withdrawn + withdrawn_at + 활성 enrollment 종료).
 * "수강 없는 재원생" 정리용 — 가역적(학생 상세에서 재원 복구 가능). 관리 도구(admin) 쓰기 권한(기본 master, 위임 시 admin/manager).
 */
export async function bulkWithdrawStudents(
  _prev: BulkStudentState,
  formData: FormData,
): Promise<BulkStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const ids = parseSelectedIds(formData);
  if (ids.length === 0) return { error: "학생을 선택해주세요" };

  const supabase = await createClient();
  const today = kstToday();
  const metadata: WithdrawalMetadata = {
    reason: "other",
    memo: "데이터 정리 일괄 퇴원",
    consultation: { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false },
  };

  // 일괄 퇴원도 감사로그에 남긴다 — 2026-08-17 배치(31명)가 "누가 했는지" 추적 불가였던 것 재발 방지.
  // 🔴 청크 중간 실패 시에도 **이미 퇴원된 만큼은** 기록한다(무기록 창 방지, 적대 리뷰 F6) — 그래서
  //    로그 id는 요청값이 아니라 update가 실제 갱신한 행(select 반환, F10 count·ids 불일치 해소).
  const done: string[] = [];
  const writeBulkLog = () =>
    done.length === 0
      ? Promise.resolve()
      : logAction({
          action: "student_bulk_withdraw",
          targetType: "student",
          metadata: { count: done.length, studentIds: done },
        });
  for (const part of chunkIds(ids)) {
    const { data: updated, error } = await supabase
      .from("students")
      .update({ status: "withdrawn", withdrawn_at: today, withdrawal_metadata: metadata })
      .in("id", part)
      .select("id");
    if (error) {
      await writeBulkLog();
      return { error: error.message };
    }
    done.push(...(updated ?? []).map((r) => r.id as string));
    // 남아있는 활성 enrollment가 있으면 함께 종료(있는 경우만 — 보통 0건)
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ end_date: today, withdrawal_reason: "other" })
      .in("student_id", part)
      .is("end_date", null);
    if (enrErr) {
      await writeBulkLog();
      return { error: enrErr.message };
    }
  }
  await writeBulkLog();

  revalidatePath("/owner");
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true, message: `${done.length}명 퇴원 처리 완료` };
}

/**
 * 선택한 학생들을 일괄 삭제(영구). 대부분 FK는 cascade지만 invoices는 onDelete=restrict이므로
 * 청구 기록이 있는 학생은 삭제 불가 → 건너뛰고 보고(퇴원 처리 권장). 관리 도구(admin) 쓰기 권한(기본 master, 위임 시 admin/manager).
 */
export async function bulkDeleteStudents(
  _prev: BulkStudentState,
  formData: FormData,
): Promise<BulkStudentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // 관리 도구(admin 메뉴) 쓰기 — 기본 matrix는 master만이나, 원장이 역할·권한에서 위임(override)하면 열림(#58).
  if (!(await canWriteTenant(user.systemRole, "admin"))) return { error: "관리 도구 권한이 없습니다" };

  const ids = parseSelectedIds(formData);
  if (ids.length === 0) return { error: "학생을 선택해주세요" };

  const supabase = await createClient();

  // 청구(invoices) 기록 있는 학생 식별 — FK restrict라 삭제 불가
  const withInvoice = new Set<string>();
  for (const part of chunkIds(ids)) {
    const { data, error } = await supabase.from("invoices").select("student_id").in("student_id", part);
    if (error) return { error: error.message };
    (data ?? []).forEach((r) => withInvoice.add(r.student_id as string));
  }

  const deletable = ids.filter((id) => !withInvoice.has(id));
  const skipped = withInvoice.size;
  if (deletable.length === 0) {
    return {
      error: `선택한 ${ids.length}명 모두 청구 기록이 있어 삭제할 수 없습니다. 퇴원 처리를 이용하세요.`,
    };
  }

  // 청크 중간 실패 시에도 이미 지워진 만큼은 기록(F6) — id는 delete가 실제 지운 행(select 반환, F10).
  const done: string[] = [];
  const writeBulkLog = () =>
    done.length === 0
      ? Promise.resolve()
      : logAction({
          action: "student_bulk_delete",
          targetType: "student",
          metadata: { count: done.length, studentIds: done },
        });
  for (const part of chunkIds(deletable)) {
    const { data: deleted, error } = await supabase
      .from("students")
      .delete()
      .in("id", part)
      .select("id");
    if (error) {
      await writeBulkLog();
      return { error: error.message };
    }
    done.push(...(deleted ?? []).map((r) => r.id as string));
  }
  const count = done.length;
  await writeBulkLog();

  revalidatePath("/owner");
  revalidatePath("/students");
  return {
    ok: true,
    message:
      skipped > 0
        ? `${count}명 삭제 완료 · ${skipped}명은 청구 기록이 있어 건너뜀(퇴원 처리 권장)`
        : `${count}명 삭제 완료`,
  };
}
