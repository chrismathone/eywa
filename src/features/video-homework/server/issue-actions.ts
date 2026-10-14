"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId, getShellView, readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { logAction } from "@/features/audit/server/log";
import { buildHolidayMap } from "@/features/attendance/calendar";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { getTenantSettings } from "@/features/owner/server/queries";
import { SITE_HOMEWORK_DAYS } from "@/features/video-submit/site";
import { EXTRA_ISSUE_LOOKBACK_DAYS, extraIssueLessonError, extraIssueWindow } from "../issue-window";
import type { LedgerEnrollment, LedgerSchedule } from "../ledger-roster";
import type { BlankAttendanceRow } from "../no-homework";
import { isVideoHomeworkDate } from "../types";
import { extraIssuesReady, findExtraIssue } from "./extra-issues";
import { loadVideoHomeworkTarget, videoHomeworkWriteError } from "./mark-write";
import { reconcileVideoHomework } from "./reconcile-outcomes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Input = { classId: string; studentId: string; date: string };
type Result = { ok: boolean; error?: string; deadline?: string;
  /** 취소: 따로 낸 표시만 지웠다(그날 수업보고서에도 영상 과제가 있어 숙제는 그대로). */
  kept?: boolean };
const TABLE = "video_homework_extra_issues";
const shortDate = (date: string) => date.slice(5).replace("-", ".");
const validInput = (input: Input) => !!input && typeof input.classId === "string" && typeof input.studentId === "string"
  && typeof input.date === "string" && UUID.test(input.classId) && UUID.test(input.studentId) && isVideoHomeworkDate(input.date);

async function refresh(tenantId: string, studentId: string) {
  // 이미 올라와 있던 영상이 새 숙제에 붙을 수 있다 — 상태와 알림은 자동 판정이 정한다(실패해도 다음 정기 확인이 맞춘다).
  // 응답 전에 끝낸다 — `after()`로 미루면 저장 응답이 다시 그린 장부에 판정 전 상태가 남는다(원장 2026-10-14, 영상 배정과 같은 까닭).
  try { await reconcileVideoHomework(tenantId, { studentId }); }
  catch (error) { reportError(error, { scope: "video-homework.after-extra-issue", tenantId, studentId }); }
  revalidatePath("/onescreen/video-homework"); revalidatePath("/lesson-reports/video-homework"); revalidatePath(`/students/${studentId}`);
}

/**
 * 영상 제출 현황의 '숙제없음' 칸에서 **그 날짜의 영상 숙제를 뒤늦게 낸다**(원장 2026-10-13 — 규칙은 `issue-window.ts`).
 *  · 수업보고서는 건드리지 않는다(그날 보고서가 없어도 낸다 · 보고서가 다시 나가지 않는다) — 학생·학부모에게는 선생님이 직접 알린다.
 *  · 권한 = 원스크린 영상 과제와 같다(`videoHomeworkWriteError`): 수업보고서 전체 권한이거나 그날 그 반을 맡은 강사.
 *  · 누구의 숙제인가(`teacher_id`) = 강사 화면에서 냈으면 그 강사, 관리자 화면에서 냈으면 **그날 보고서를 쓴 사람**(그날 실제로 가르친 강사 —
 *    영어 팀티칭 등), 보고서가 없으면 그 반 담임 — 강사 화면의 '내가 낸 숙제'에 서고 제출·미제출 알림을 받는다.
 * 🔴 화면이 보낸 날짜를 믿지 않는다 — 그날 수업을 들었는지 · 이미 숙제가 있는지 · 다음 수업 전인지 전부 여기서 다시 본다.
 */
export async function issueExtraVideoHomework(input: Input): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!validInput(input)) return { ok: false, error: "반·학생·날짜를 확인해 주세요." };
  const { classId, studentId, date } = input;
  const today = kstToday();
  if (date > today) return { ok: false, error: "아직 수업하지 않은 날에는 영상 숙제를 낼 수 없습니다." };
  if (date < addDays(today, -EXTRA_ISSUE_LOOKBACK_DAYS)) return { ok: false, error: `${EXTRA_ISSUE_LOOKBACK_DAYS}일이 지난 수업에는 영상 숙제를 낼 수 없습니다.` };
  const denied = await videoHomeworkWriteError(user, classId, date);
  if (denied) return { ok: false, error: denied };
  const db = createAdminClient();
  try {
    if (!(await extraIssuesReady(db))) return { ok: false, error: "아직 사용할 수 없는 기능입니다. 잠시 뒤 다시 시도해 주세요." };
    const scoped = (table: string, columns: string) => db.from(table).select(columns).eq("tenant_id", user.tenantId).eq("class_id", classId);
    const [target, cls, schedules, enrollments, attendance, reports, existing, settings, view] = await Promise.all([
      loadVideoHomeworkTarget(db, user.tenantId, classId, studentId),
      db.from("classes").select("teacher_id").eq("tenant_id", user.tenantId).eq("id", classId).maybeSingle(),
      scoped("class_schedules", "day_of_week,valid_from,valid_to"),
      scoped("enrollments", "class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days").eq("student_id", studentId),
      fetchAllPaged<BlankAttendanceRow>((from, to) => db.from("attendance_records")
        .select("id,student_id,class_id,session_date,slot_start,status,recorded_at").eq("tenant_id", user.tenantId)
        .eq("class_id", classId).eq("student_id", studentId).gte("session_date", date).lt("session_date", addDays(today, 1))
        .order("id", { ascending: true }).range(from, to)),
      scoped("lesson_reports", "report_date,video_homework,created_by").eq("student_id", studentId).gte("report_date", date).lt("report_date", addDays(today, 1)),
      findExtraIssue(db, user.tenantId, { classId, studentId, date }),
      getTenantSettings(),
      getShellView(),
    ]);
    if (target.error !== null) return { ok: false, error: target.error };
    if (!target.enabled) return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
    if (cls.error || schedules.error || enrollments.error || reports.error || !cls.data)
      return { ok: false, error: "수업 정보를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    if (existing || ((reports.data ?? []) as unknown as { report_date: string; video_homework: boolean | null }[]).some((row) => row.report_date === date && row.video_homework === true))
      return { ok: false, error: "이미 영상 숙제가 나간 날입니다. 화면을 새로고침해 주세요." };
    const scheduleRows = (schedules.data ?? []) as unknown as LedgerSchedule[];
    const enrollmentRows = (enrollments.data ?? []) as unknown as LedgerEnrollment[];
    const reportRows = (reports.data ?? []) as unknown as { report_date: string; video_homework: boolean | null; created_by: string | null }[];
    const records = effectiveAttendanceRecords(attendance);
    const lessonError = extraIssueLessonError({ date, schedules: scheduleRows, enrollments: enrollmentRows,
      slots: records.filter((row) => row.session_date === date).map((row) => ({ status: row.status })) });
    if (lessonError) return { ok: false, error: lessonError };
    const holidays = buildHolidayMap(settings.operations.holidays);
    const window = extraIssueWindow({ homeworkDate: date, today, schedules: scheduleRows, enrollments: enrollmentRows,
      isHoliday: (day) => day in holidays,
      lessonDates: [...records.map((row) => row.session_date), ...reportRows.map((row) => row.report_date)] });
    if (!window.open) return { ok: false, error: `다음 수업(${shortDate(window.nextLesson)})이 지나 낼 수 없습니다. 따로 내는 숙제는 다음 수업 전까지만 됩니다.` };
    const reportAuthor = reportRows.find((row) => row.report_date === date && row.created_by)?.created_by ?? null;
    const teacherId = view === "teacher" ? (await effectiveTeacherId()) ?? user.id : reportAuthor ?? (cls.data.teacher_id as string | null) ?? user.id;
    const { error } = await db.from(TABLE).insert({ tenant_id: user.tenantId, class_id: classId, student_id: studentId,
      homework_date: date, teacher_id: teacherId, issued_by: user.id });
    if (error) return { ok: false, error: error.code === "23505" ? "이미 영상 숙제가 나간 날입니다. 화면을 새로고침해 주세요." : "영상 숙제를 내지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    const deadline = addDays(date, SITE_HOMEWORK_DAYS);
    await logAction({ action: "lesson_report_video_homework_issue", targetType: "video_homework",
      targetLabel: [target.studentName, target.className].filter(Boolean).join(" · ") || null,
      metadata: { classId, studentId, homeworkDate: date, deadline, teacherId } });
    await refresh(user.tenantId, studentId);
    return { ok: true, deadline };
  } catch (error) {
    reportError(error, { scope: "video-homework.extra-issue", tenantId: user.tenantId, studentId });
    return { ok: false, error: "영상 숙제를 내지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}

const CANCEL_ERRORS: Record<string, string> = {
  missing: "따로 낸 숙제를 찾을 수 없습니다. 화면을 새로고침해 주세요.",
  marked: "직접 찍은 기록이 있는 숙제입니다. 기록을 미확인으로 되돌린 뒤 취소해 주세요.",
  has_video: "이미 영상이 올라온 숙제는 취소할 수 없습니다.",
};

/**
 * 따로 낸 숙제를 거둔다 — 잘못 낸 숙제가 7일 뒤 '미수행'으로 굳지 않게 하는 되돌리는 문([[#103]]).
 * 권한 = 수업보고서 전체 권한이거나 그 숙제의 선생님 본인. 영상이 붙었거나 직접 찍은 기록이 있으면 DB 함수가 거절한다(자동 판정과 같은 잠금).
 */
export async function cancelExtraVideoHomework(input: Input): Promise<Result> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!validInput(input)) return { ok: false, error: "반·학생·날짜를 확인해 주세요." };
  const { classId, studentId, date } = input;
  const db = createAdminClient();
  try {
    const [issue, level, target] = await Promise.all([
      findExtraIssue(db, user.tenantId, { classId, studentId, date }),
      accessLevelTenant(user.systemRole, "lesson_reports"),
      loadVideoHomeworkTarget(db, user.tenantId, classId, studentId),
    ]);
    if (!issue) return { ok: false, error: CANCEL_ERRORS.missing };
    if (level !== "full") {
      if (!(await canWriteTenant(user.systemRole, "teacher_onescreen"))) return { ok: false, error: "수정 권한이 없습니다." };
      if (issue.teacherId !== ((await effectiveTeacherId()) ?? user.id)) return { ok: false, error: "내가 낸 숙제만 취소할 수 있습니다." };
    }
    const { data, error } = await db.rpc("cancel_video_homework_extra_issue", { p_tenant: user.tenantId, p_class: classId, p_student: studentId, p_date: date });
    if (error) return { ok: false, error: "숙제를 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
    if (data !== "cancelled" && data !== "kept") return { ok: false, error: CANCEL_ERRORS[String(data)] ?? "숙제를 취소하지 못했습니다." };
    await logAction({ action: "lesson_report_video_homework_issue_cancel", targetType: "video_homework",
      targetLabel: target.error === null ? [target.studentName, target.className].filter(Boolean).join(" · ") || null : null,
      metadata: { classId, studentId, homeworkDate: date, ...(data === "kept" ? { keptByReport: true } : {}) } });
    await refresh(user.tenantId, studentId);
    return { ok: true, ...(data === "kept" ? { kept: true } : {}) };
  } catch (error) {
    reportError(error, { scope: "video-homework.extra-issue-cancel", tenantId: user.tenantId, studentId });
    return { ok: false, error: "숙제를 취소하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
}
