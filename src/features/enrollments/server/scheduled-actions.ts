"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { isValidYmd, kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { toKoreanDbError } from "../db-errors";

export type ScheduledActionState = { error?: string; ok?: true };
type ScheduleInput = { enrollmentId: string; pairedEnrollmentId?: string };
type ChangedSchedule = {
  ok: true;
  studentId: string;
  classId: string;
  fromClassId: string | null;
  startDate: string;
  nextClassId: string | null;
  nextDate: string | null;
};

const ERRORS: Record<string, string> = {
  scheduled_invalid_request: "예약 요청이 올바르지 않습니다.",
  scheduled_missing: "수강 정보를 찾을 수 없습니다. 새로고침 후 확인해 주세요.",
  scheduled_started: "이미 시작된 수강은 예약으로 수정할 수 없습니다.",
  scheduled_has_next_move: "이후에 예약된 반 이동을 먼저 취소해 주세요.",
  scheduled_pair_changed: "반 이동의 이전 수강을 확인할 수 없습니다. 새로고침 후 다시 확인해 주세요.",
  scheduled_changed: "예약이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
  scheduled_invalid_date: "적용일은 내일 이후여야 합니다.",
  scheduled_invalid_period: "이동할 반과 날짜가 기존 수강 기간과 맞지 않습니다.",
  scheduled_target_missing: "이동할 반을 찾을 수 없거나 운영이 종료되었습니다.",
};

/** 두 수강의 검증·잠금·쓰기를 하나의 RPC로 처리해 부분 성공이 남지 않게 한다. */
async function changeSchedule(
  input: ScheduleInput,
  action: "cancel" | "reschedule",
  date?: string,
  classId?: string,
): Promise<{ error: string } | { result: ChangedSchedule }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes"))) return { error: "예약 변경은 관리자만 할 수 있습니다" };
  if (date && !isValidYmd(date)) return { error: "날짜 형식이 올바르지 않습니다" };
  if (date && date <= kstToday()) return { error: "적용일은 내일 이후여야 합니다" };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_scheduled_enrollment", {
    p_enrollment_id: input.enrollmentId,
    p_paired_enrollment_id: input.pairedEnrollmentId ?? null,
    p_action: action,
    p_date: date ?? null,
    p_class_id: classId ?? null,
  });
  if (error) return { error: toKoreanDbError(error, "예약을 변경하지 못했습니다", "enrollments.scheduled.change") };
  const result = data as ChangedSchedule | { ok: false; error: string } | null;
  if (!result?.ok) {
    const detail = result?.error ?? "";
    return { error: ERRORS[detail] ?? toKoreanDbError({ message: detail }, "예약을 변경하지 못했습니다", "enrollments.scheduled.change") };
  }
  return { result };
}

function refreshSchedule(result: ChangedSchedule) {
  revalidatePath(`/students/${result.studentId}`);
  for (const classId of new Set([result.classId, result.fromClassId, result.nextClassId])) {
    if (classId) revalidatePath(`/classes/${classId}`);
  }
  revalidatePath("/timetable");
}

/** 날짜를 바꾸면 새 반 시작과 이전 반의 종료 경계가 함께 바뀐다. */
export async function rescheduleEnrollment(input: ScheduleInput & {
  date?: string;
  newClassId?: string;
}): Promise<ScheduledActionState> {
  const changed = await changeSchedule(input, "reschedule", input.date?.trim() || undefined, input.newClassId?.trim() || undefined);
  if ("error" in changed) return changed;
  const { result } = changed;
  await logAction({
    action: "enrollment_reschedule",
    targetType: "student",
    metadata: {
      studentIds: [result.studentId], enrollmentId: input.enrollmentId,
      pairedEnrollmentId: input.pairedEnrollmentId ?? null,
      from: { date: result.startDate, classId: result.classId },
      to: { date: result.nextDate, classId: result.nextClassId },
    },
  });
  refreshSchedule(result);
  return { ok: true };
}

/** 새 반 예약 삭제와 이전 반 복구가 모두 성공해야 취소가 완료된다. */
export async function cancelScheduledEnrollment(input: ScheduleInput): Promise<ScheduledActionState> {
  const changed = await changeSchedule(input, "cancel");
  if ("error" in changed) return changed;
  const { result } = changed;
  await logAction({
    action: "enrollment_schedule_cancel",
    targetType: "student",
    metadata: {
      studentIds: [result.studentId], enrollmentId: input.enrollmentId,
      pairedEnrollmentId: input.pairedEnrollmentId ?? null,
      canceled: { date: result.startDate, classId: result.classId },
    },
  });
  refreshSchedule(result);
  return { ok: true };
}
