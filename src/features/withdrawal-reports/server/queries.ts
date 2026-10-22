import "server-only";
import { cache } from "react";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { getViewerStaffScope } from "@/features/staff/department/server/subject-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { canRequestReport, isParticipant, missingReportSchema, snapshotMatches, type StudentSnapshot, type WithdrawalReport, type ReportListRow, type ReportEvent, type StaffOption, type StudentOption, type CourseSnapshot } from "../model";
import { kstToday } from "@/lib/date-kst";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { protectedAccountIds } from "@/lib/auth/protected-accounts";
import { displayRoleFor } from "@/lib/auth/super-admin";
import { staffSubjectScopeOf } from "@/features/staff/department/subject-scope";
import { loadReportPrefill } from "./prefill";
import { reportConsultations } from "./consultations";

export const reportViewer = cache(async () => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canAccessTenant(user.systemRole, "withdrawal_reports")) || !(await isFeatureOptedIn(user.tenantId, "laboratory"))) return null;
  const [writable, scope, teacherId] = await Promise.all([canWriteTenant(user.systemRole, "withdrawal_reports"), getViewerStaffScope(user), effectiveTeacherId()]);
  const manage = !teacherId && canRequestReport(user.systemRole);
  return { user, writable, scope, teacherId, manage, request: manage && writable };
});

export function canReadReport(r: ReportListRow, viewer: NonNullable<Awaited<ReturnType<typeof reportViewer>>>) {
  return viewer.teacherId ? r.teacher_id === viewer.teacherId : viewer.user.systemRole === "master" || isParticipant(r, viewer.user.id);
}
const REPORT_COLUMNS = "id,enrollment_ids,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,body,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at,group_id,group_leader,manager_ids,director_ids,manager_decisions,director_decisions";
const REPORT_LIST_COLUMNS = "id,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at,group_id,group_leader,manager_ids,director_ids,manager_decisions,director_decisions,body_reason:body->>reason,body_detail:body->>detail,body_reason_detail:body->>reasonDetail";
const COURSE_COLUMNS = "id,start_date,end_date,on_hold,is_transferred,classes!inner(id,class_name,subject,is_active,closed_at,teacher_id,teacher:teacher_id(display_name))";
type JoinedCourse = { id: string; start_date: string; end_date: string | null; on_hold: boolean; is_transferred: boolean; classes: { id: string; class_name: string; subject: string; is_active: boolean; closed_at: string | null; teacher_id: string | null; teacher: { display_name: string } | null } };
function currentCourses(rows: JoinedCourse[]): CourseSnapshot[] {
  return rows.flatMap(e => {
    const c = e.classes;
    if (!c || (e.end_date && (e.end_date < kstToday() || e.is_transferred))) return [];
    return [{ id: e.id, classId: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: c.teacher?.display_name ?? null, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold }];
  });
}
async function currentSnapshot(tenant: string, student: string): Promise<StudentSnapshot | null> {
  const { data, error } = await createAdminClient().from("students").select(`name,school,grade,enrolled_at,status,withdrawn_at,enrollments(${COURSE_COLUMNS})`).eq("tenant_id", tenant).eq("id", student)
    .eq("enrollments.tenant_id", tenant).eq("enrollments.classes.tenant_id", tenant).eq("enrollments.classes.teacher.tenant_id", tenant).maybeSingle();
  if (error) throw new Error("현재 학생·담당 강사를 확인하지 못했습니다.");
  return data ? { name: data.name, school: data.school, grade: data.grade, enrolledAt: data.enrolled_at, status: data.status, withdrawnAt: data.withdrawn_at, courses: currentCourses(data.enrollments as unknown as JoinedCourse[]) } : null;
}
export async function listReports() {
  const viewer = await reportViewer();
  if (!viewer) return { rows: [] as ReportListRow[], available: false, completedLimited: false };
  const base = () => {
    let q = createAdminClient().from("withdrawal_reports").select(REPORT_LIST_COLUMNS).eq("tenant_id", viewer.user.tenantId);
    if (viewer.teacherId) q = q.eq("teacher_id", viewer.teacherId);
    else if (viewer.user.systemRole !== "master") q = q.or([...(["requested_by", "teacher_id", "manager_id", "director_id"].map(k => `${k}.eq.${viewer.user.id}`)), `manager_ids.cs.{${viewer.user.id}}`, `director_ids.cs.{${viewer.user.id}}`].join(","));
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
  const [{ data: events, error: eventError }, current] = await Promise.all([
    db.from("withdrawal_report_events").select("id,actor_id,action,from_status,to_status,comment,created_at").eq("tenant_id", viewer.user.tenantId).eq("report_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300),
    ["completed", "canceled"].includes(data.status) ? Promise.resolve(null) : currentSnapshot(viewer.user.tenantId, data.student_id),
  ]);
  if (eventError) throw new Error("보고서 처리 이력을 불러오지 못했습니다.");
  const assignmentChanged = !["completed", "canceled"].includes(data.status) && (!current || !snapshotMatches(data.snapshot as StudentSnapshot, current));
  // 작성 중 수납은 최신 장부를 사용하고, 제출한 보고서는 제출 당시 값을 보존한다.
  const draft = ["requested", "revision"].includes(data.status) && !assignmentChanged;
  const [prefill, consultations] = await Promise.all([
    draft ? loadReportPrefill(data as WithdrawalReport, viewer.user.systemRole) : Promise.resolve({ prefill: undefined, prefillWarning: undefined }),
    reportConsultations(data as WithdrawalReport, viewer),
  ]);
  return { report: data as WithdrawalReport, events: [...(events ?? [])].reverse() as ReportEvent[], assignmentChanged, consultations, ...prefill };
}
export async function reportStaff() {
  const viewer = await reportViewer();
  if (!viewer) return [] as StaffOption[];
  const { data, error } = await createAdminClient().from("users").select("id,display_name,system_role,subjects")
    .eq("tenant_id", viewer.user.tenantId).eq("status", "active").in("system_role", ["teacher", "manager", "admin", "master"]).order("display_name");
  if (error) throw new Error("직원 목록을 불러오지 못했습니다.");
  const [protection, settings] = await Promise.all([protectedAccountIds((data ?? []).map(u => u.id)), getTenantSettings()]);
  if (protection.lookupFailed) throw new Error("직원 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  return (data ?? []).map(u => ({ id: u.id, name: u.display_name, role: displayRoleFor(u.id, u.system_role, protection.protectedIds), subjects: u.subjects ?? [],
    approvalSubjects: staffSubjectScopeOf(u.id, settings.permissions.specialAccess.staffSubjectScopes) ?? u.subjects ?? [] })) as StaffOption[];
}
export async function requestStudents() {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as StudentOption[];
  const db = createAdminClient();
  const result: StudentOption[] = [];
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await db.from("students")
      .select(`id,name,school,grade,enrollments(${COURSE_COLUMNS})`)
      .eq("tenant_id", viewer.user.tenantId).eq("is_test", false).in("status", ["enrolled", "on_hold"]).is("withdrawn_at", null)
      .eq("enrollments.tenant_id", viewer.user.tenantId).eq("enrollments.classes.tenant_id", viewer.user.tenantId).eq("enrollments.classes.teacher.tenant_id", viewer.user.tenantId)
      .order("id").range(offset, offset + 399);
    if (error) throw new Error("학생의 수강 정보를 불러오지 못했습니다.");
    for (const student of data ?? []) {
      const courses = currentCourses((student.enrollments as unknown as JoinedCourse[]).filter(e => e.classes?.is_active && !e.classes.closed_at));
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
