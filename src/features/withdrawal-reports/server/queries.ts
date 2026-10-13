import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getViewerStaffScope } from "@/features/staff/server/subject-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canRequestReport, isParticipant, missingReportSchema, type WithdrawalReport, type ReportListRow, type ReportEvent, type StaffOption, type StudentOption, type CourseSnapshot } from "../model";
import { kstToday } from "@/lib/date-kst";
import { subjectLabelRecord } from "@/features/owner/subjects";

export const reportViewer = cache(async () => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canAccessTenant(user.systemRole, "withdrawal_reports")) || !(await isFeatureOptedIn(user.tenantId, "laboratory"))) return null;
  const [writable, scope] = await Promise.all([canWriteTenant(user.systemRole, "withdrawal_reports"), getViewerStaffScope(user)]);
  return { user, writable, scope, request: canRequestReport(user.systemRole) && writable };
});

export function canReadReport(r: ReportListRow, viewer: NonNullable<Awaited<ReturnType<typeof reportViewer>>>) {
  return viewer.user.systemRole === "master" || (isParticipant(r, viewer.user.id) &&
    (r.teacher_id === viewer.user.id || !viewer.scope || r.subjects.every(s => viewer.scope!.includes(s))));
}
const REPORT_COLUMNS = "id,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,body,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at";
const REPORT_LIST_COLUMNS = "id,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at";
export async function listReports() {
  const viewer = await reportViewer();
  if (!viewer) return { rows: [] as ReportListRow[], available: false, completedLimited: false };
  const base = () => {
    let q = createAdminClient().from("withdrawal_reports").select(REPORT_LIST_COLUMNS).eq("tenant_id", viewer.user.tenantId);
    if (viewer.user.systemRole !== "master") q = q.or(["requested_by", "teacher_id", "manager_id", "director_id"].map(k => `${k}.eq.${viewer.user.id}`).join(","));
    return q;
  };
  const rows: ReportListRow[] = [];
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await base().not("status", "in", "(completed,canceled)").order("created_at", { ascending: false }).order("id").range(offset, offset + 399);
    if (missingReportSchema(error)) return { rows: [], available: false, completedLimited: false };
    if (error) throw new Error("퇴원보고서를 불러오지 못했습니다.");
    rows.push(...((data ?? []) as ReportListRow[]).filter(r => canReadReport(r, viewer)));
    if (!data || data.length < 400) break;
  }
  const { data, error } = await base().in("status", ["completed", "canceled"]).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error("완료된 퇴원보고서를 불러오지 못했습니다.");
  rows.push(...((data ?? []) as ReportListRow[]).filter(r => canReadReport(r, viewer)));
  return { rows, available: true, completedLimited: data?.length === 200 };
}
export async function getReport(id: string) {
  const viewer = await reportViewer();
  if (!viewer) return null;
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_reports").select(REPORT_COLUMNS).eq("tenant_id", viewer.user.tenantId).eq("id", id).maybeSingle();
  if (error || !data || !canReadReport(data as WithdrawalReport, viewer)) return null;
  const { data: events, error: eventError } = await db.from("withdrawal_report_events")
    .select("id,actor_id,action,from_status,to_status,comment,created_at").eq("tenant_id", viewer.user.tenantId).eq("report_id", id).order("created_at").limit(300);
  if (eventError) throw new Error("보고서 처리 이력을 불러오지 못했습니다.");
  return { report: data as WithdrawalReport, events: (events ?? []) as ReportEvent[] };
}
export async function reportStaff() {
  const viewer = await reportViewer();
  if (!viewer) return [] as StaffOption[];
  const { data, error } = await createAdminClient().from("users").select("id,display_name,system_role,subjects")
    .eq("tenant_id", viewer.user.tenantId).eq("status", "active").in("system_role", ["teacher", "manager", "admin", "master"]).order("display_name");
  if (error) throw new Error("직원 목록을 불러오지 못했습니다.");
  return (data ?? []).map(u => ({ id: u.id, name: u.display_name, role: u.system_role, subjects: u.subjects ?? [] })) as StaffOption[];
}
export async function requestStudents() {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as StudentOption[];
  const db = createAdminClient();
  const result: StudentOption[] = [];
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await db.from("students")
      .select("id,name,school,grade,enrollments(id,start_date,end_date,on_hold,is_transferred,classes!inner(id,class_name,subject,teacher_id))")
      .eq("tenant_id", viewer.user.tenantId).in("status", ["enrolled", "on_hold"]).is("withdrawn_at", null)
      .eq("enrollments.tenant_id", viewer.user.tenantId).eq("enrollments.classes.tenant_id", viewer.user.tenantId)
      .order("id").range(offset, offset + 399);
    if (error) throw new Error("학생의 수강 정보를 불러오지 못했습니다.");
    for (const student of data ?? []) {
      const courses = student.enrollments.flatMap(e => {
        const c = Array.isArray(e.classes) ? e.classes[0] : e.classes;
        if (!c || (e.end_date && (e.end_date < kstToday() || e.is_transferred))) return [];
        return [{ id: e.id, classId: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: null,
          startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold }] as CourseSnapshot[];
      });
      if (courses.length && (!viewer.scope || courses.some(c => viewer.scope!.includes(c.subject)))) result.push({ id: student.id, name: student.name, school: student.school, grade: student.grade, courses });
    }
    if (!data || data.length < 400) break;
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
export async function reportSubjectLabels() {
  const settings = await getTenantSettings();
  return subjectLabelRecord(settings.operations.subjects);
}
