"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { logAction } from "@/features/audit/server/log";
import { addDays, kstToday } from "@/lib/date-kst";
import { isVideoHomeworkDate, type VideoHomeworkStatus } from "../types";
import { videoHomeworkColumnReady } from "./assignments";
import { loadVideoHomeworkTarget, videoHomeworkWriteError, writeVideoHomeworkMark, type MarkWriteResult } from "./mark-write";

const STATUSES: readonly (VideoHomeworkStatus | null)[] = ["submitted", "missing", null];
const badSubmittedDate = (value: string | null | undefined) =>
  value != null && (!isVideoHomeworkDate(value) || value > kstToday());

/** 원스크린 '지난 수업 영상 숙제' 검사 — 검사한 수업일 자리에 적는다(같은 숙제의 기록이 이미 있으면 그 줄을 고친다). */
export async function setVideoHomeworkMark(input: {
  classId: string;
  studentId: string;
  checkDate: string;
  homeworkDate: string | null;
  submittedDate?: string | null;
  status: VideoHomeworkStatus | null;
}): Promise<MarkWriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!isVideoHomeworkDate(input.checkDate) || (input.homeworkDate !== null && !isVideoHomeworkDate(input.homeworkDate)))
    return { ok: false, error: "수업 날짜가 올바르지 않습니다." };
  if (input.checkDate > kstToday()) return { ok: false, error: "미래 수업의 숙제는 검사할 수 없습니다." };
  if (badSubmittedDate(input.submittedDate)) return { ok: false, error: "제출일은 오늘까지의 올바른 날짜로 입력해 주세요." };
  if (input.homeworkDate && input.homeworkDate > input.checkDate)
    return { ok: false, error: "지난 숙제 날짜는 검사일보다 늦을 수 없습니다." };
  if (!STATUSES.includes(input.status)) return { ok: false, error: "유효하지 않은 상태입니다." };
  const denied = await videoHomeworkWriteError(user, input.classId, input.checkDate);
  if (denied) return { ok: false, error: denied };

  const db = createAdminClient();
  if (input.status !== null) {
    const target = await loadVideoHomeworkTarget(db, user.tenantId, input.classId, input.studentId);
    if (target.error !== null) return { ok: false, error: target.error };
    if (!target.enabled) return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
  }
  const { data: enrollments, error: enrollmentError } = await db
    .from("enrollments")
    .select("start_date,end_date,on_hold,is_transferred")
    .eq("tenant_id", user.tenantId)
    .eq("class_id", input.classId)
    .eq("student_id", input.studentId)
    .or(`start_date.is.null,start_date.lte.${input.checkDate}`)
    .or(`end_date.is.null,end_date.gte.${input.checkDate}`);
  if (enrollmentError) return { ok: false, error: enrollmentError.message };
  const enrolledOnDate = (enrollments ?? []).some((row) => isEnrollmentActiveOn({
    startDate: row.start_date ?? "", endDate: row.end_date,
    onHold: row.on_hold === true, isTransferred: row.is_transferred === true,
  }, input.checkDate));
  if (!enrolledOnDate) {
    // 보강 학생은 해당 반의 정규 수강이 없어도 출결이나 예약으로 강사 명단에 나타난다.
    const scope = (table: string) => db.from(table).select("id")
      .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId);
    const [attendance, reservation, existing] = await Promise.all([
      scope("attendance_records").eq("session_date", input.checkDate).limit(1),
      scope("makeup_reservations").eq("makeup_date", input.checkDate).eq("status", "reserved").limit(1),
      scope("video_homework_marks").eq("check_date", input.checkDate).limit(1),
    ]);
    if (attendance.error || reservation.error || existing.error)
      return { ok: false, error: attendance.error?.message ?? reservation.error?.message ?? existing.error?.message };
    if (!attendance.data?.length && !reservation.data?.length && !existing.data?.length)
      return { ok: false, error: "해당 수업 날짜의 학생을 찾을 수 없습니다." };
  }
  return writeVideoHomeworkMark(db, { tenantId: user.tenantId, userId: user.id, classId: input.classId, studentId: input.studentId,
    slotDate: input.checkDate, slotIsMine: true, homeworkDate: input.homeworkDate, submittedDate: input.submittedDate, status: input.status });
}

/**
 * 영상 제출 현황(장부) — **회차 한 칸**을 찍는다. 회차 = `h:숙제일`(숙제가 나간 수업) 또는 `c:검사일`(숙제일 없는 옛 기록).
 * 새 기록의 자리는 서버가 정한다(숙제일 다음 날 — `writeVideoHomeworkMark`) — 화면이 보낸 날짜를 저장 키로 믿지 않는다.
 */
export async function setVideoHomeworkRound(input: {
  classId: string;
  studentId: string;
  roundKey: string;
  submittedDate?: string | null;
  status: VideoHomeworkStatus | null;
}): Promise<MarkWriteResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  const [kind, date] = [input.roundKey.slice(0, 2), input.roundKey.slice(2)];
  if ((kind !== "h:" && kind !== "c:") || !isVideoHomeworkDate(date)) return { ok: false, error: "회차를 확인할 수 없습니다." };
  if (date > kstToday()) return { ok: false, error: "아직 나가지 않은 숙제는 기록할 수 없습니다." };
  if (!STATUSES.includes(input.status)) return { ok: false, error: "유효하지 않은 상태입니다." };
  if (badSubmittedDate(input.submittedDate)) return { ok: false, error: "제출일은 오늘까지의 올바른 날짜로 입력해 주세요." };
  const homeworkDate = kind === "h:" ? date : null;
  if (homeworkDate && input.submittedDate && input.submittedDate < homeworkDate)
    return { ok: false, error: "제출일은 숙제가 나간 날보다 빠를 수 없습니다." };
  const denied = await videoHomeworkWriteError(user, input.classId, date);
  if (denied) return { ok: false, error: denied };

  const db = createAdminClient();
  const target = await loadVideoHomeworkTarget(db, user.tenantId, input.classId, input.studentId);
  if (target.error !== null) return { ok: false, error: target.error };
  if (input.status !== null && !target.enabled)
    return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
  // 그 회차가 실제로 있나 — 이미 찍힌 기록이거나, 그날 그 반 보고서에 '영상 과제 있음'이 남아 있어야 한다.
  const marks = db.from("video_homework_marks").select("id")
    .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId);
  const recorded = await (homeworkDate ? marks.eq("homework_date", homeworkDate) : marks.eq("check_date", date).is("homework_date", null)).limit(1);
  if (recorded.error) return { ok: false, error: recorded.error.message };
  if (!recorded.data?.length) {
    const assigned = homeworkDate && (await videoHomeworkColumnReady(db)) ? await db.from("lesson_reports").select("id")
      .eq("tenant_id", user.tenantId).eq("class_id", input.classId).eq("student_id", input.studentId)
      .eq("report_date", homeworkDate).eq("video_homework", true).limit(1) : null;
    if (assigned?.error) return { ok: false, error: assigned.error.message };
    if (!assigned?.data?.length) return { ok: false, error: "그날 이 학생에게 나간 영상 과제를 찾을 수 없습니다." };
  }
  const result = await writeVideoHomeworkMark(db, { tenantId: user.tenantId, userId: user.id, classId: input.classId,
    studentId: input.studentId, slotDate: homeworkDate ? addDays(homeworkDate, 1) : date, homeworkDate,
    submittedDate: input.submittedDate, status: input.status });
  if (result.ok) await logAction({
    action: "lesson_report_video_homework_mark",
    targetType: "video_homework",
    targetLabel: [target.studentName, target.className].filter(Boolean).join(" · ") || null,
    metadata: { classId: input.classId, studentId: input.studentId, homeworkDate, checkDate: homeworkDate ? null : date,
      status: input.status ?? "cleared", submittedDate: input.status === "submitted" ? input.submittedDate ?? null : null },
  });
  return result;
}
