import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays } from "@/lib/date-kst";
import type { TeacherScope } from "@/lib/auth/teacher-scope";
import { teacherWork } from "./teacher-work";
import { isVideoHomeworkEnabled, type VideoHomeworkPolicy } from "@/features/video-homework/policy";

/** 호출자는 dashboard와 lesson_reports 권한을 확인한다. service 조회는 RLS로 읽은 반 ID로 제한한다. */
export async function loadTeacherWork(tenantId: string, today: string, scope: TeacherScope | null, policy: VideoHomeworkPolicy) {
  const db = await createClient();
  const classes = await fetchAllPaged<{ id: string; subject: string; teacher_id: string | null }>((from, to) =>
    db.from("classes").select("id,subject,teacher_id").eq("tenant_id", tenantId).eq("is_active", true).eq("report_optout", false)
      .or(`closed_at.is.null,closed_at.gte.${today}`).order("id").range(from, to));
  const visible = scope ? classes.filter((c) => scope.classIds.includes(c.id)) : classes;
  const classIds = visible.map((c) => c.id);
  const range = { reportFrom: addDays(today, -6), videoFrom: addDays(today, -29), to: today };
  const admin = createAdminClient();
  const [teachers, reports, outcomes] = await Promise.all([
    fetchInChunks<{ id: string; display_name: string }>([...new Set(visible.flatMap((c) => c.teacher_id ? [c.teacher_id] : []))], (chunk) =>
      db.from("users").select("id,display_name").eq("tenant_id", tenantId).in("id", chunk)),
    fetchAllPagedInChunks<{ id: string; class_id: string; student_id: string; report_date: string; classnote_status: string | null; video_homework: boolean; student: { grade: string | null } | { grade: string | null }[] }>(classIds, (chunk, from, to) =>
      db.from("lesson_reports").select("id,class_id,student_id,report_date,classnote_status,video_homework,student:students!inner(is_test,grade)")
        .eq("tenant_id", tenantId).eq("student.is_test", false).in("class_id", chunk).gte("report_date", range.videoFrom).lte("report_date", today)
        .order("created_at", { ascending: false }).order("id").range(from, to)),
    fetchAllPagedInChunks<{ class_id: string; student_id: string; homework_date: string; status: string; observed_at: string }>(classIds, (chunk, from, to) =>
      admin.from("video_homework_auto_outcomes").select("class_id,student_id,homework_date,status,observed_at").eq("tenant_id", tenantId)
        .in("class_id", chunk).gte("homework_date", range.videoFrom).lte("homework_date", today).order("class_id").order("student_id").order("homework_date").range(from, to)),
  ]);
  const names = new Map(teachers.map((t) => [t.id, t.display_name]));
  const subjects = new Map(visible.map((c) => [c.id, c.subject]));
  return teacherWork(visible.map((c) => ({ id: c.id, teacherId: c.teacher_id, teacherName: c.teacher_id ? names.get(c.teacher_id) ?? "이름 확인 필요" : "담당 미지정", subject: c.subject })),
    reports.map((r) => ({ id: r.id, classId: r.class_id, studentId: r.student_id, date: r.report_date, status: r.classnote_status,
      videoHomework: r.video_homework === true && isVideoHomeworkEnabled(policy, { classId: r.class_id, subjectKey: subjects.get(r.class_id) ?? "", grade: (Array.isArray(r.student) ? r.student[0] : r.student)?.grade ?? null }) })),
    outcomes.map((r) => ({ classId: r.class_id, studentId: r.student_id, date: r.homework_date, status: r.status, observedAt: r.observed_at })), range);
}
