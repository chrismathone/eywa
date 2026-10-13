import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstMinutesOfDay } from "@/lib/date-kst";
import type { TeacherScope } from "@/lib/auth/teacher-scope";
import type { TenantSettings } from "@/features/owner/settings-types";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { programSubjectsOf, subjectGroupOf } from "@/features/students/program";
import { teacherWork, type WorkClass, type WorkReport } from "./teacher-work";
import { isTestClass, reportWorkObligations, resolveUnclassifiedReports, type WorkAttendance, type WorkEnrollment, type WorkSchedule } from "./work-targets";
import { isReportTrackedSubject } from "../report-subjects";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import { listExtraIssues } from "@/features/video-homework/server/extra-issues";

/** RLS 반 범위에서 현재 담당 반의 업무를 집계한다. 관리자 조회도 테넌트·허용 반으로 제한한다. */
export async function loadTeacherWork(tenantId: string, today: string, scope: TeacherScope | null, settings: TenantSettings) {
  const db = await createClient();
  const classes = await fetchAllPaged<{ id: string; class_name: string; subject: string; teacher_id: string | null }>((from, to) =>
    db.from("classes").select("id,class_name,subject,teacher_id").eq("tenant_id", tenantId).eq("is_active", true).eq("report_optout", false)
      .or(`closed_at.is.null,closed_at.gte.${today}`).order("id").range(from, to));
  const visible = classes.filter((c) => !isTestClass(c.class_name) && (!scope || scope.classIds.includes(c.id)));
  const classIds = visible.map((c) => c.id);
  const range = { reportFrom: addDays(today, -6), videoFrom: addDays(today, -29), to: today };
  if (!classIds.length) return teacherWork([], [], [], range, []);
  const admin = createAdminClient();
  const [teachers, reports, outcomes, schedules, enrollments, attendance, posts, unclassified, extraIssues] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string }>([...new Set(visible.flatMap((c) => c.teacher_id ? [c.teacher_id] : []))], (chunk) =>
      db.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string; report_date: string; covers_date: string | null; classnote_status: string | null; video_homework: boolean; student: { grade: string | null } | { grade: string | null }[] }>(classIds, (chunk, from, to) =>
      db.from("lesson_reports").select("id,class_id,student_id,report_date,covers_date,classnote_status,video_homework,student:students!inner(is_test,grade)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk).lte("report_date", today)
        .or(`report_date.gte.${range.videoFrom},covers_date.gte.${range.reportFrom}`)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
    fetchAllPagedInChunks<{ class_id: string; student_id: string; homework_date: string; status: string; observed_at: string }>(classIds, (chunk, from, to) =>
      admin.from("video_homework_auto_outcomes").select("class_id,student_id,homework_date,status,observed_at").eq("tenant_id", tenantId)
        .in("class_id", chunk).gte("homework_date", range.videoFrom).lte("homework_date", today).order("class_id").order("student_id").order("homework_date").range(from, to)),
    fetchAllPagedInChunks<WorkSchedule>(classIds, (chunk, from, to) =>
      db.from("class_schedules").select("class_id,day_of_week,start_time,valid_from,valid_to").eq("tenant_id", tenantId).in("class_id", chunk)
        .or(`valid_from.is.null,valid_from.lte.${today}`).or(`valid_to.is.null,valid_to.gte.${range.reportFrom}`).order("id").range(from, to)),
    fetchAllPagedInChunks<WorkEnrollment>(classIds, (chunk, from, to) =>
      db.from("enrollments").select("class_id,student_id,start_date,end_date,on_hold,is_transferred,attendance_days,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk)
        .or(`start_date.is.null,start_date.lte.${today}`).or(`end_date.is.null,end_date.gte.${range.reportFrom}`).order("id").range(from, to)),
    fetchAllPagedInChunks<WorkAttendance>(classIds, (chunk, from, to) =>
      db.from("attendance_records").select("id,student_id,class_id,session_date,slot_start,status,recorded_at")
        .eq("tenant_id", tenantId).in("class_id", chunk).gte("session_date", range.reportFrom).lte("session_date", today).order("id").range(from, to)),
    classnoteModuleOn(settings) ? fetchAllPaged<{ board_name: string; posted_on: string }>((from, to) =>
      db.from("classnote_class_posts").select("board_name,posted_on").eq("tenant_id", tenantId)
        .gte("posted_on", range.reportFrom).lte("posted_on", today).order("board_name").order("posted_on").range(from, to)) : Promise.resolve([]),
    fetchAllPaged<{ id: string; student_id: string; report_date: string; covers_date: string | null; subject: string | null; teacher_name: string | null; classnote_status: string | null }>((from, to) =>
      db.from("lesson_reports").select("id,student_id,report_date,covers_date,subject,teacher_name,classnote_status,student:students!inner(is_test)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).is("class_id", null).lte("report_date", today)
        .or(`report_date.gte.${range.reportFrom},covers_date.gte.${range.reportFrom}`)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
    // 보고서 없이 따로 낸 영상 숙제(원장 2026-10-13) — 장부와 같은 숙제 축. 못 읽으면 보고서 쪽 숫자만 낸다(카드가 죽지 않게).
    listExtraIssues(admin, tenantId, { fromDate: range.videoFrom, toDate: today }).catch(() => []),
  ]);
  // 따로 낸 숙제의 학생 — 학년(학교급 제외 설정)·테스트 여부는 학생 표에서 읽는다(보고서가 없는 학생도 있다 · 장부와 같은 판정).
  // 못 읽으면 따로 낸 숙제를 빼고 보고서 쪽 숫자만 낸다.
  const extraStudents = await fetchInChunks<{ id: string; grade: string | null; is_test: boolean }>([...new Set(extraIssues.map((x) => x.studentId))],
    (chunk) => admin.from("students").select("id,grade,is_test").eq("tenant_id", tenantId).in("id", chunk)).catch(() => null);
  const extraStudentOf = new Map((extraStudents ?? []).map((s) => [s.id, s]));
  const names = new Map(teachers.map((t) => [t.id, t.display_name]));
  const subjects = new Map(visible.map((c) => [c.id, c.subject]));
  const programs = programSubjectsOf(Object.fromEntries(settings.operations.subjects.map((s) => [s.key, s.label])));
  const workClasses: WorkClass[] = visible.map((c) => {
    const teacherName = c.teacher_id ? names.get(c.teacher_id) ?? "이름 확인 필요" : "담당 미지정";
    const english = subjectGroupOf(c.subject, programs) === "english";
    return { id: c.id, name: c.class_name, teacherId: c.teacher_id, teacherName, subject: c.subject,
      reportSource: settings.report.writingExemptTeachers.includes(teacherName) ? "none" : english && classnoteModuleOn(settings) ? "classnote"
        : !english && isReportTrackedSubject(c.subject, settings.report.classnoteSubjects) ? "lesson" : "none" };
  });
  const workReports: WorkReport[] = reports.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, date: r.report_date,
    coversDate: r.covers_date, status: r.classnote_status,
    videoHomework: r.video_homework === true && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, {
      classId: r.class_id, subjectKey: subjects.get(r.class_id) ?? "", grade: (Array.isArray(r.student) ? r.student[0] : r.student)?.grade ?? null }) }));
  workReports.push(...resolveUnclassifiedReports(unclassified.map((r) => ({ id: r.id, studentId: r.student_id, date: r.report_date,
    coversDate: r.covers_date, subject: r.subject, teacherName: r.teacher_name, status: r.classnote_status, videoHomework: false })), workClasses, enrollments, schedules));
  const obligations = reportWorkObligations({ classes: workClasses, reports: workReports, schedules, enrollments, attendance,
    posts: posts.map((p) => ({ boardName: p.board_name, postedOn: p.posted_on })), from: range.reportFrom, to: today,
    nowMinutes: kstMinutesOfDay(), holidays: settings.operations.holidays.map((h) => h.date) });
  return teacherWork(workClasses, workReports, outcomes.map((r) => ({ classId: r.class_id, studentId: r.student_id,
    date: r.homework_date, status: r.status, observedAt: r.observed_at })), range, obligations,
    extraIssues.filter((x) => { const student = extraStudentOf.get(x.studentId); return !!student && !student.is_test
      && isVideoHomeworkEnabled(settings.report.videoHomeworkPolicy, { classId: x.classId, subjectKey: subjects.get(x.classId) ?? "", grade: student.grade }); }));
}
