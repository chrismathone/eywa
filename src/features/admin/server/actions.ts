"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
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
    })
    .eq("id", mergeeId);

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
  let closedCount = 0;
  for (const part of chunkIds(ids)) {
    const { error, count } = await supabase
      .from("enrollments")
      .update(
        { end_date: today, withdrawal_reason: "퇴원에 따른 자동 종료" },
        { count: "exact" },
      )
      .in("student_id", part)
      .is("end_date", null);
    if (error) return { error: error.message };
    closedCount += count ?? 0;
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

  let count = 0;
  for (const part of chunkIds(ids)) {
    const { error, count: c } = await supabase
      .from("students")
      .update(
        { status: "withdrawn", withdrawn_at: today, withdrawal_metadata: metadata },
        { count: "exact" },
      )
      .in("id", part);
    if (error) return { error: error.message };
    count += c ?? 0;
    // 남아있는 활성 enrollment가 있으면 함께 종료(있는 경우만 — 보통 0건)
    const { error: enrErr } = await supabase
      .from("enrollments")
      .update({ end_date: today, withdrawal_reason: "other" })
      .in("student_id", part)
      .is("end_date", null);
    if (enrErr) return { error: enrErr.message };
  }

  revalidatePath("/owner");
  revalidatePath("/students");
  revalidatePath("/withdrawals");
  return { ok: true, message: `${count}명 퇴원 처리 완료` };
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

  let count = 0;
  for (const part of chunkIds(deletable)) {
    const { error, count: c } = await supabase
      .from("students")
      .delete({ count: "exact" })
      .in("id", part);
    if (error) return { error: error.message };
    count += c ?? 0;
  }

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
