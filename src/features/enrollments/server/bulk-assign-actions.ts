"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyClassAssignment } from "@/features/notifications/server/notify";
import { isOverlapConflict, toKoreanDbError } from "../db-errors";
import { enrollmentAssignBlockReason } from "../eligibility";
import { BULK_ASSIGN_MAX, type BulkAssignResult } from "../bulk-assign";
import { VALID_DAYS, describeOverlapConflict, normalizeAttendanceDays } from "./assign-helpers";

export type BulkAssignState = { error?: string; results?: BulkAssignResult[] };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** 한 번에 넣는 수 — 행마다 GiST 판정을 따로 받아야 누가 왜 막혔는지 말할 수 있어 한 줄씩 넣는다. */
const INSERT_CONCURRENCY = 5;

/**
 * **단체 배정**(원장 2026-09-18 *"특강같은 수업에 단체 배정하고 싶은데"* · *"수업에서 원생 배정할떄는 단체 배정
 * 가능하게"*) — 반 하나에 여러 학생을 같은 시작일·종료일·등원 요일로 한 번에 넣는다.
 *
 * 🔴 **한 명 배정(`createEnrollment`)과 규칙이 같아야 한다** — 게이트(classes·students 중 full) · 재원생만
 *    (`enrollmentAssignBlockReason`) · 등원 요일 정리 · 겹침 안내 · 담임 알림 · 건별 감사로그. 두 벌이 갈리면
 *    단체로 넣을 때만 휴원 학생이 들어간다([[#77]]).
 * 🔴 **한 명이 막혀도 나머지는 들어간다** — 한 번에 insert하면 겹침 하나가 전원을 되돌린다. 대신 학생마다
 *    결과를 돌려주고 화면이 막힌 사람과 이유를 남긴다(조용히 빠뜨리지 않는다).
 */
export async function createEnrollmentsBulk(input: {
  classId: string;
  studentIds: string[];
  startDate: string;
  endDate: string | null;
  attendanceDays: string[];
}): Promise<BulkAssignState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (
    !(await canManageTenant(user.systemRole, "classes")) &&
    !(await canManageTenant(user.systemRole, "students"))
  ) {
    return { error: "반 배정 권한이 없습니다 — 강사 계정은 열람 전용입니다" };
  }

  const classId = String(input.classId ?? "").trim();
  const studentIds = [...new Set((input.studentIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
  const startDate = String(input.startDate ?? "").trim() || kstToday();
  const endDate = String(input.endDate ?? "").trim() || null;
  const pickedDays = (input.attendanceDays ?? []).map((d) => String(d).trim()).filter((d) => VALID_DAYS.has(d));

  if (!classId) return { error: "반을 선택해주세요" };
  if (studentIds.length === 0) return { error: "학생을 한 명 이상 선택해주세요" };
  if (studentIds.length > BULK_ASSIGN_MAX) {
    return { error: `한 번에 ${BULK_ASSIGN_MAX}명까지 배정할 수 있습니다 — 나눠서 배정해 주세요` };
  }
  if (!ISO.test(startDate) || (endDate && !ISO.test(endDate))) {
    return { error: "날짜 형식이 올바르지 않습니다" };
  }
  // 수강 기간은 반열림 [시작, 종료) — 종료가 시작과 같거나 앞이면 빈 기간이라 N명 모두 쓰레기 행이 된다.
  if (endDate && endDate <= startDate) return { error: "종료일은 시작일보다 뒤여야 합니다" };

  const supabase = await createClient();
  // 반은 RLS로 본 테넌트 것인지 확인(타 테넌트 반 id면 null) · 학생 상태는 청크로(B3) — 둘은 독립이라 병렬(B4).
  let klass: { id: string } | null;
  let rows: { id: string; status: string | null }[];
  try {
    const [classRes, studentRows] = await Promise.all([
      supabase.from("classes").select("id").eq("id", classId).maybeSingle(),
      fetchInChunks(studentIds, (chunk) =>
        supabase.from("students").select("id, status").in("id", chunk),
      ),
    ]);
    klass = classRes.data;
    rows = studentRows as { id: string; status: string | null }[];
  } catch {
    return { error: "학생 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));

  const attendanceDays = await normalizeAttendanceDays(supabase, classId, pickedDays);

  const insertOne = async (studentId: string): Promise<BulkAssignResult> => {
    if (!statusOf.has(studentId)) return { studentId, ok: false, error: "학생을 찾을 수 없습니다" };
    // 🔴 재원 학생만 — 한 명 배정과 같은 판정(insert 앞).
    const blocked = enrollmentAssignBlockReason(statusOf.get(studentId) ?? null);
    if (blocked) return { studentId, ok: false, error: blocked };
    const { data, error } = await supabase
      .from("enrollments")
      .insert({
        tenant_id: user.tenantId,
        student_id: studentId,
        class_id: classId,
        start_date: startDate,
        end_date: endDate,
        attendance_days: attendanceDays,
      })
      .select("id")
      .single();
    if (error || !data) {
      if (isOverlapConflict(error)) {
        return {
          studentId,
          ok: false,
          error: await describeOverlapConflict(supabase, studentId, classId, startDate, endDate),
        };
      }
      return { studentId, ok: false, error: toKoreanDbError(error, "수강 배정에 실패했습니다.") };
    }
    return { studentId, ok: true, enrollmentId: data.id };
  };

  const results: BulkAssignResult[] = [];
  for (let i = 0; i < studentIds.length; i += INSERT_CONCURRENCY) {
    results.push(...(await Promise.all(studentIds.slice(i, i + INSERT_CONCURRENCY).map(insertOne))));
  }

  const done = results.filter((r) => r.ok);
  if (done.length > 0) {
    // 담임 알림은 한 번에(한 명씩 보내면 벨이 N번 울린다) — best-effort.
    await notifyClassAssignment({
      tenantId: user.tenantId,
      actorId: user.id,
      assignments: done.map((r) => ({ classId, studentId: r.studentId })),
      type: "enrollment_assigned",
    });
    // 감사로그는 **학생마다** — 한 명 배정과 같은 키라 이력·역검수가 두 경로를 구분 없이 읽는다.
    await Promise.all(
      done.map((r) =>
        logAction({
          action: "enrollment_assign",
          targetType: "student",
          metadata: { studentId: r.studentId, classId, startDate, days: attendanceDays, bulk: true },
        }),
      ),
    );
    revalidatePath("/timetable");
    revalidatePath(`/classes/${classId}`);
    for (const r of done) revalidatePath(`/students/${r.studentId}`);
  }
  return { results };
}
