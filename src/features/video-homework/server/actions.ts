"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getTeachingClassIds } from "@/features/classes/server/delegation";
import { isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { kstToday } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { isVideoHomeworkEnabled } from "../policy";
import { isVideoHomeworkDate, type VideoHomeworkStatus } from "../types";

export async function setVideoHomeworkMark(input: {
  classId: string;
  studentId: string;
  checkDate: string;
  homeworkDate: string | null;
  status: VideoHomeworkStatus | null;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  const readonlyError = await readonlyTeacherViewError();
  if (readonlyError) return { ok: false, error: readonlyError };
  if (!isVideoHomeworkDate(input.checkDate) || (input.homeworkDate !== null && !isVideoHomeworkDate(input.homeworkDate)))
    return { ok: false, error: "수업 날짜가 올바르지 않습니다." };
  if (input.checkDate > kstToday()) return { ok: false, error: "미래 수업의 숙제는 검사할 수 없습니다." };
  if (input.homeworkDate && input.homeworkDate > input.checkDate)
    return { ok: false, error: "지난 숙제 날짜는 검사일보다 늦을 수 없습니다." };
  if (input.status !== null && !(["submitted", "timed", "missing"] as const).includes(input.status))
    return { ok: false, error: "유효하지 않은 상태입니다." };
  const manager = (await accessLevelTenant(user.systemRole, "lesson_reports")) === "full";
  if (!manager) {
    if (!(await canWriteTenant(user.systemRole, "teacher_onescreen")))
      return { ok: false, error: "수정 권한이 없습니다." };
    const classes = await getTeachingClassIds(await createClient(), user.id, input.checkDate);
    if (!classes.all.includes(input.classId)) return { ok: false, error: "담당 반만 수정할 수 있습니다." };
  }

  const db = createAdminClient();
  if (input.status !== null) {
    const [classResult, studentResult, settings] = await Promise.all([
      db.from("classes").select("subject").eq("tenant_id", user.tenantId).eq("id", input.classId).maybeSingle(),
      db.from("students").select("grade").eq("tenant_id", user.tenantId).eq("id", input.studentId).maybeSingle(),
      getTenantSettings(),
    ]);
    if (classResult.error || studentResult.error)
      return { ok: false, error: classResult.error?.message ?? studentResult.error?.message };
    if (!classResult.data || !studentResult.data)
      return { ok: false, error: "해당 반이나 학생을 찾을 수 없습니다." };
    if (!isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId: input.classId, subjectKey: classResult.data.subject, grade: studentResult.data.grade,
    })) return { ok: false, error: "영상 제출 검사 대상이 아닙니다. 보고서 설정을 확인해 주세요." };
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
    const [attendance, reservation, existing] = await Promise.all([
      db.from("attendance_records").select("id")
        .eq("tenant_id", user.tenantId).eq("class_id", input.classId)
        .eq("student_id", input.studentId).eq("session_date", input.checkDate).limit(1),
      db.from("makeup_reservations").select("id")
        .eq("tenant_id", user.tenantId).eq("class_id", input.classId)
        .eq("student_id", input.studentId).eq("makeup_date", input.checkDate)
        .eq("status", "reserved").limit(1),
      db.from("video_homework_marks").select("id")
        .eq("tenant_id", user.tenantId).eq("class_id", input.classId)
        .eq("student_id", input.studentId).eq("check_date", input.checkDate).limit(1),
    ]);
    if (attendance.error || reservation.error || existing.error)
      return { ok: false, error: attendance.error?.message ?? reservation.error?.message ?? existing.error?.message };
    if (!attendance.data?.length && !reservation.data?.length && !existing.data?.length)
      return { ok: false, error: "해당 수업 날짜의 학생을 찾을 수 없습니다." };
  }

  if (input.status === null) {
    const { error } = await db.from("video_homework_marks").delete()
      .eq("tenant_id", user.tenantId).eq("class_id", input.classId)
      .eq("student_id", input.studentId).eq("check_date", input.checkDate);
    return error ? { ok: false, error: error.message } : { ok: true };
  }
  const { error } = await db.from("video_homework_marks").upsert({
    tenant_id: user.tenantId,
    class_id: input.classId,
    student_id: input.studentId,
    check_date: input.checkDate,
    homework_date: input.homeworkDate,
    status: input.status,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id,class_id,student_id,check_date" });
  return error ? { ok: false, error: error.message } : { ok: true };
}
