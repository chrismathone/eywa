import "server-only";
import { cache } from "react";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { getViewerStaffScope } from "@/features/staff/department/server/subject-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { EMPTY_BODY, cancelsAsDirector, canRequestReport, isBookkeepingReport, isParticipant, missingReportSchema, snapshotMatches, type StudentSnapshot, type WithdrawalReport, type ReportListRow, type ReportEvent, type StaffOption, type StudentOption, type CourseSnapshot } from "../model";
import { kstToday } from "@/lib/date-kst";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { protectedAccountIds } from "@/lib/auth/protected-accounts";
import { displayRoleFor } from "@/lib/auth/super-admin";
import { staffSubjectScopeOf } from "@/features/staff/department/subject-scope";
import { loadReportPrefill } from "./prefill";
import { loadReportBilling } from "./billing";
import { loadDeskStaff, loadLaterInvoices, type LaterInvoice } from "./refund";
import { liveBillingForSubmitted } from "../prefill";
import { reportConsultations } from "./consultations";
import type { SubjectHistoryRow } from "../course-period";
import { reportCourses, withUnassignedCourses } from "../target-courses";
import { isReportOptout } from "@/features/classes/report-optout";
import { narrowApprovalSubjects } from "../request-options";
import { loadOpenReportScopes, withOpenReports, type OpenReportScope } from "./open-reports";

// 실험실 판정은 운영 콘솔 배정을 따른다(`isLaboratoryMenuAvailable`) — 예전엔 실험실 사용 여부를 배정과 무관하게 물어서,
// 원장이 퇴원보고서를 일반 메뉴로 돌려도(2026-10-23) 실험실을 안 켠 지점에선 계속 닫혀 있었다.
export const reportViewer = cache(async () => {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canAccessTenant(user.systemRole, "withdrawal_reports")) || !(await isLaboratoryMenuAvailable(user.tenantId, "withdrawal_reports"))) return null;
  const [writable, scope, teacherId] = await Promise.all([canWriteTenant(user.systemRole, "withdrawal_reports"), getViewerStaffScope(user), effectiveTeacherId()]);
  const manage = !teacherId && canRequestReport(user.systemRole);
  // 열람 과목(원장 2026-10-30 "각 과목 관리자급은 … 열람") — 승인 담당 과목(`reportStaff`의 approvalSubjects)과 같은 기준:
  // 특수권한 과목 범위 → 없으면 직원의 담당 과목 → 둘 다 없으면 전 과목. 원장은 늘 전부.
  let readScope: readonly string[] | null = scope;
  if (manage && user.systemRole !== "master" && !scope) {
    const { data } = await createAdminClient().from("users").select("subjects").eq("tenant_id", user.tenantId).eq("id", user.id).maybeSingle();
    const own = ((data as { subjects: string[] | null } | null)?.subjects ?? []).filter(Boolean);
    readScope = own.length ? own : null;
  }
  return { user, writable, scope, readScope, teacherId, manage, request: manage && writable };
});

/**
 * 보고서 열람 — 강사는 본인 배정만. 원장은 전부. **관리자급(관리자·매니저)도 승인자로 지정되지 않은 보고서를 '열람'으로 본다**
 * (원장 2026-10-30 *"각 과목 관리자급은 요청서 승인이 없어도 '열람'형식으로 볼 수 있게 … 원장급도 마찬가지"*) — 담당 과목 범위가
 * 걸린 관리자는 그 과목 보고서만(범위 없으면 전부). 쓰기(작성·승인·취소)는 DB 처리 함수가 행위자를 따로 검사하므로 열람이 넓어져도
 * 그대로다(transition_withdrawal_report — 작성 = 배정 강사 · 승인 = 지정 승인자의 차례 · 취소 = 요청자·원장).
 */
export function canReadReport(r: ReportListRow, viewer: NonNullable<Awaited<ReturnType<typeof reportViewer>>>) {
  if (viewer.teacherId) return r.teacher_id === viewer.teacherId;
  if (viewer.user.systemRole === "master" || isParticipant(r, viewer.user.id)) return true;
  return viewer.manage && (!viewer.readScope || (r.subjects ?? []).some((s) => viewer.readScope!.includes(s)));
}
const REPORT_COLUMNS = "id,enrollment_ids,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,body,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at,group_id,group_leader,manager_ids,director_ids,manager_decisions,director_decisions";
const REPORT_LIST_COLUMNS = "id,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,exit_kind,subjects,effective_date,request_note,snapshot,status,revision,manager_approved_at,director_approved_at,applied_at,last_comment,created_at,updated_at,group_id,group_leader,manager_ids,director_ids,manager_decisions,director_decisions,body_reason:body->>reason,body_detail:body->>detail,body_reason_detail:body->>reasonDetail,body_student:body->>studentConsultation,body_parent:body->>parentConsultation,body_opinion:body->>teacherOpinion,body_attendance:body->>attendance,body_tuition:body->>tuition,body_arrears_note:body->>arrearsNote";
const COURSE_COLUMNS = "id,start_date,end_date,on_hold,is_transferred,classes!inner(id,class_name,subject,english_track,is_active,closed_at,report_optout,teacher_id,teacher:teacher_id(display_name))";
type JoinedCourse = { id: string; start_date: string; end_date: string | null; on_hold: boolean; is_transferred: boolean; classes: { id: string; class_name: string; subject: string; english_track: string | null; is_active: boolean; closed_at: string | null; report_optout: boolean | null; teacher_id: string | null; teacher: { display_name: string } | null } };
function currentCourses(rows: JoinedCourse[]): CourseSnapshot[] {
  return rows.flatMap(e => {
    const c = e.classes;
    if (!c || (e.end_date && (e.end_date < kstToday() || e.is_transferred))) return [];
    return [{ id: e.id, classId: c.id, className: c.class_name, subject: c.subject, teacherId: c.teacher_id, teacherName: c.teacher?.display_name ?? null, startDate: e.start_date, endDate: e.end_date, onHold: e.on_hold, ...(isReportOptout(c) ? { reportOptout: true } : {}), ...(c.english_track === "eie" ? { eie: true } : {}) }];
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
    else if (viewer.user.systemRole !== "master" && !(viewer.manage && !viewer.readScope)) {
      // 관리자급은 담당 과목 보고서도 열람(canReadReport와 같은 규칙) — 과목 키는 따옴표로 감싼다(PostgREST 배열 값).
      // 배열 문법을 깨는 글자(따옴표·역슬래시·중괄호)가 든 키는 싣지 않는다(목록 전체가 400으로 죽지 않게 — 그 과목은 canReadReport가 못 보게 둔다).
      const keys = viewer.manage ? (viewer.readScope ?? []).filter((s) => !/["\\{}]/.test(s)) : [];
      const subjectScope = keys.length ? [`subjects.ov.{${keys.map((s) => `"${s}"`).join(",")}}`] : [];
      q = q.or([...(["requested_by", "teacher_id", "manager_id", "director_id"].map(k => `${k}.eq.${viewer.user.id}`)), `manager_ids.cs.{${viewer.user.id}}`, `director_ids.cs.{${viewer.user.id}}`, ...subjectScope].join(","));
    }
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
  // 완료·취소는 최근 200건까지 — 장부 정리가 남긴 바로 처리 보고서(`isBookkeepingReport`)는 목록에서 빼고, 그 행들이 200건 창을 먹지 않게
  // 더 읽어 채운다(한 번 정리에 수십~백여 명이 몰려 진짜 완료 보고서가 창 밖으로 밀리지 않게 · 최대 5쪽).
  const completed: ReportListRow[] = [];
  let completedLimited = false;
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await base().in("status", ["completed", "canceled"]).order("created_at", { ascending: false }).order("id").range(offset, offset + 199);
    if (error) throw new Error("완료된 퇴원보고서를 불러오지 못했습니다.");
    const page = (data ?? []) as ReportListRow[];
    completed.push(...page.filter(r => !isBookkeepingReport(r) && canReadReport(r, viewer)));
    if (page.length < 200) break;
    if (completed.length >= 200 || offset >= 800) { completedLimited = true; break; }
  }
  rows.push(...completed.slice(0, 200));
  return { rows, available: true, completedLimited: completedLimited || completed.length > 200 };
}
export async function getReport(id: string) {
  const viewer = await reportViewer();
  if (!viewer) return null;
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_reports").select(REPORT_COLUMNS).eq("tenant_id", viewer.user.tenantId).eq("id", id).maybeSingle();
  if (error || !data || !canReadReport(data as WithdrawalReport, viewer)) return null;
  // 대조 과목 = 묶음의 과목(DB 처리 함수와 같다) — 못 읽으면 이 보고서의 과목.
  let groupSubjects: string[] | null = null;
  if (data.group_id && data.enrollment_ids) {
    const { data: group, error: groupError } = await db.from("withdrawal_report_groups").select("enrollment_ids,teacher_ids,subjects").eq("tenant_id", viewer.user.tenantId).eq("id", data.group_id).maybeSingle();
    if (groupError) console.error("[withdrawal-report-group]", groupError.message);
    else if (group) { data.enrollment_ids = withUnassignedCourses(data as WithdrawalReport, group); groupSubjects = group.subjects; }
  }
  const [{ data: events, error: eventError }, current] = await Promise.all([
    db.from("withdrawal_report_events").select("id,actor_id,action,from_status,to_status,comment,created_at").eq("tenant_id", viewer.user.tenantId).eq("report_id", id).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(300),
    ["completed", "canceled"].includes(data.status) ? Promise.resolve(null) : currentSnapshot(viewer.user.tenantId, data.student_id),
  ]);
  if (eventError) throw new Error("보고서 처리 이력을 불러오지 못했습니다.");
  const assignmentChanged = !["completed", "canceled"].includes(data.status) && (!current || !snapshotMatches(data.snapshot as StudentSnapshot, current, data.exit_kind === "withdrawal" ? undefined : groupSubjects ?? data.subjects));
  // 작성 중엔 출결·수납을 최신으로 채운다. 제출한 보고서도 **수납은 지금 장부**로 보인다(원장 2026-10-29 "같은 곳을 가르켜야") —
  // 수납 탭과 다른 숫자를 결재하지 않게. 제출 때와 달라졌으면 그 값을 덧붙인다(liveBillingForSubmitted). 장부를 못 읽으면 저장된 값 그대로.
  // 완료·취소된 보고서는 끝난 기록이라 저장된 값 그대로다(퇴원 뒤 환불로 장부가 바뀌어도 그때 문서를 바꾸지 않는다).
  const draft = ["requested", "revision"].includes(data.status) && !assignmentChanged;
  const submitted = !["requested", "revision", "completed", "canceled"].includes(data.status);
  // 승인자가 아닌 열람자(원장 2026-10-30 열람 확대)는 수납 메뉴를 볼 수 있을 때만 지금 장부·퇴원 뒤 청구를 본다.
  const billingOk = viewer.teacherId !== null || viewer.user.systemRole === "master" || isParticipant(data as WithdrawalReport, viewer.user.id)
    || (await canAccessTenant(viewer.user.systemRole, "billing"));
  // 그 과목의 전체 수강 이력(지난 반 포함 — 원장 2026-10-29) — 다른 조회와 함께 띄운다. 못 읽으면 빈 목록(수강기간은 지금 반 기준으로).
  // 완료·취소된 보고서는 처음 열 때의 이력을 보고서에 고정한다(원장 2026-10-30 — 나중에 수강 기록을 고쳐도 끝난 문서가 바뀌지 않게).
  // 완료는 DB 함수 한 곳이지만 부르는 길이 셋(승인 · 처리일 cron · 바로 처리)이라 여기서 처음 열 때 고정한다. 못 읽은 이력([])은 고정하지 않는다.
  const finished = ["completed", "canceled"].includes(data.status);
  const frozen = (data.snapshot as StudentSnapshot).subjectHistory;
  const historyPromise = finished && Array.isArray(frozen) ? Promise.resolve(frozen)
    : loadSubjectHistory(data as WithdrawalReport)
      .then(async (rows) => { if (finished) await freezeSubjectHistory(data as WithdrawalReport, rows); return rows; })
      .catch((e) => { console.error("[withdrawal-report-subject-history]", e); return [] as SubjectHistoryRow[]; });
  const [prefill, consultations] = await Promise.all([
    draft ? loadReportPrefill(data as WithdrawalReport, viewer.user.systemRole)
      : !submitted && ["completed", "canceled"].includes(data.status) ? Promise.resolve({ prefill: undefined, prefillWarning: undefined })
      : !billingOk ? Promise.resolve({ prefill: undefined, prefillWarning: undefined })
      : loadReportBilling(data as WithdrawalReport)
        .then(live => ({ prefill: submitted ? liveBillingForSubmitted({ ...EMPTY_BODY, ...(data as WithdrawalReport).body }, live) : live, prefillWarning: undefined }))
        .catch(() => ({ prefill: undefined, prefillWarning: "수납 정보를 지금 장부에서 불러오지 못해 제출 때 값을 보여줍니다." })),
    reportConsultations(data as WithdrawalReport, viewer),
  ]);
  const subjectHistory = await historyPromise;
  // 퇴원월 뒤 청구(원장 2026-10-29) — 취소된 보고서는 보이지 않는다. 못 읽으면 빈 목록(보고서 화면은 연다).
  const laterInvoices: LaterInvoice[] = data.status === "canceled" || !billingOk ? []
    : await loadLaterInvoices(data as WithdrawalReport).catch((e) => { console.error("[withdrawal-report-later-invoices]", e); return []; });
  // 데스크 담당자 목록은 환불을 승인할 수 있는 원장에게만(이름 목록을 다른 사람에게 내리지 않는다).
  // 승인 권한과 같은 기준 · 자기 자신은 빼고(자기 알림은 가지 않음 — notifyUsers).
  const deskStaff = laterInvoices.length && cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId)
    ? (await loadDeskStaff(viewer.user.tenantId).catch(() => [])).filter(s => s.id !== viewer.user.id) : [];
  return { report: data as WithdrawalReport, events: [...(events ?? [])].reverse() as ReportEvent[], assignmentChanged, consultations, laterInvoices, deskStaff, subjectHistory, ...prefill };
}
/** 완료·취소된 보고서의 수강기간 이력을 보고서에 고정 — 아직 고정되지 않았을 때만(동시에 열어도 한 번). 실패해도 화면은 지금 이력으로 연다. */
async function freezeSubjectHistory(report: WithdrawalReport, rows: SubjectHistoryRow[]) {
  const { error } = await createAdminClient().from("withdrawal_reports")
    .update({ snapshot: { ...report.snapshot, subjectHistory: rows } })
    .eq("tenant_id", report.tenant_id).eq("id", report.id).in("status", ["completed", "canceled"]).is("snapshot->subjectHistory", null);
  if (error) console.error("[withdrawal-report-freeze-history]", error.message);
}
/** 이 보고서 과목들에서 학생이 다닌 반 전부(지난 반 포함) — 수강기간 칸(subjectPeriods). */
async function loadSubjectHistory(report: WithdrawalReport): Promise<SubjectHistoryRow[]> {
  const subjects = [...new Set(reportCourses(report).map(c => c.subject))];
  if (!subjects.length) return [];
  const { data, error } = await createAdminClient().from("enrollments")
    .select("id,start_date,end_date,classes!inner(class_name,subject)")
    .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id)
    .in("classes.subject", subjects).lte("start_date", report.effective_date).order("start_date").limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const klass = row.classes as unknown as { class_name: string | null; subject: string | null } | null;
    if (!klass?.subject || !row.start_date) return [];
    return [{ enrollmentId: String(row.id), subject: klass.subject, className: (klass.class_name ?? "").trim() || "이름 없는 반", startDate: String(row.start_date).slice(0, 10), endDate: row.end_date ? String(row.end_date).slice(0, 10) : null }];
  });
}
export async function reportStaff() {
  const viewer = await reportViewer();
  if (!viewer) return [] as StaffOption[];
  const { data, error } = await createAdminClient().from("users").select("id,display_name,system_role,subjects")
    .eq("tenant_id", viewer.user.tenantId).eq("status", "active").in("system_role", ["teacher", "manager", "admin", "master"]).order("display_name");
  if (error) throw new Error("직원 목록을 불러오지 못했습니다.");
  const [protection, settings] = await Promise.all([protectedAccountIds((data ?? []).map(u => u.id)), getTenantSettings()]);
  if (protection.lookupFailed) throw new Error("직원 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  // 🔴 침산 지점 superadmin(lsy93@gmail.com · st2000423@gmail.com 등)은 절대 승인자로 넣지 않는다 — 원장 칸에는 진짜 원장만(원장 2026-10-30).
  //    system_role이 master라 그대로 두면 원장 후보가 되고, DB도 관리자 칸은 막지 않는다. 표시 역할을 admin으로 바꿔 원장 후보에서,
  //    승인 과목을 비워 관리자 후보에서 뺀다(요청 화면에 superadmin 여부를 내려보내지 않는다).
  //    학원 설정 '퇴원보고서 승인자'가 있으면 그 사람이 맡은 과목은 그 사람만 승인 후보(`narrowApprovalSubjects`).
  return narrowApprovalSubjects((data ?? []).map(u => ({ id: u.id, name: u.display_name, role: displayRoleFor(u.id, u.system_role, protection.protectedIds), subjects: u.subjects ?? [],
    approvalSubjects: protection.protectedIds.has(u.id) ? [] : staffSubjectScopeOf(u.id, settings.permissions.specialAccess.staffSubjectScopes) ?? u.subjects ?? [] })) as StaffOption[],
    settings.permissions.specialAccess.withdrawalApproverIds ?? []);
}
/**
 * 작성 요청·바로 처리 창의 학생 선택지 — 재원·휴원 · 퇴원 예약 없음 · 시험 학생 제외.
 * 지금 다니는 반이 없는 학생도 싣는다(`courses: []`) — 강사 작성 요청은 담임이 없어 못 하지만 **관리자 바로 처리**(퇴원만)는 된다
 * (원장 2026-10-23 · 창이 요청 모드에선 반 있는 학생만 보인다). 과목 범위가 걸린 사람에겐 담당 과목 반이 있는 학생만.
 */
export async function requestStudents() {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as StudentOption[];
  const db = createAdminClient();
  const result: StudentOption[] = [];
  // 진행 중인 보고서를 못 읽어도 창은 연다 — 같은 과목 요청은 DB가 거절한다.
  const openReports = loadOpenReportScopes(viewer.user.tenantId).catch((e: unknown) => { console.error("[withdrawal-open-reports]", e); return new Map<string, OpenReportScope>(); });
  for (let offset = 0; ; offset += 400) {
    const { data, error } = await db.from("students")
      .select(`id,name,school,grade,enrollments(${COURSE_COLUMNS})`)
      .eq("tenant_id", viewer.user.tenantId).eq("is_test", false).in("status", ["enrolled", "on_hold"]).is("withdrawn_at", null)
      .eq("enrollments.tenant_id", viewer.user.tenantId).eq("enrollments.classes.tenant_id", viewer.user.tenantId).eq("enrollments.classes.teacher.tenant_id", viewer.user.tenantId)
      .order("id").range(offset, offset + 399);
    if (error) throw new Error("학생의 수강 정보를 불러오지 못했습니다.");
    const open = await openReports;
    for (const student of data ?? []) {
      const courses = currentCourses((student.enrollments as unknown as JoinedCourse[]).filter(e => e.classes?.is_active && !e.classes.closed_at));
      if (!(viewer.scope ? courses.some(c => viewer.scope!.includes(c.subject)) : true)) continue;
      const option = withOpenReports({ id: student.id, name: student.name, school: student.school, grade: student.grade, courses }, open.get(student.id));
      if (option && (!viewer.scope || option.courses.some(c => viewer.scope!.includes(c.subject)))) result.push(option);
    }
    if (!data || data.length < 400) break;
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
/**
 * 관리자 바로 처리가 이 DB에서 되는가 — 0453a(`withdrawal_reports.direct` 칸 + 바로 처리 함수, 한 트랜잭션)가 적용됐는지 칸으로 본다.
 * 🔴 적용 전 DB에서도 화면은 그대로 열리고 바로 처리 선택지만 숨는다(#95 — 앱이 마이그레이션보다 먼저 배포될 수 있다).
 */
export const directProcessingReady = cache(async (tenantId: string): Promise<boolean> => {
  const { error } = await createAdminClient().from("withdrawal_reports").select("direct").eq("tenant_id", tenantId).limit(1);
  return !error;
});

/**
 * 원생 화면의 '퇴원보고서' 입구(원장 2026-10-23 퇴원은 퇴원보고서로만) — 그 학생에게 진행 중인 보고서가 있으면 그 보고서로, 없으면 요청 창으로.
 * null = 퇴원보고서를 못 여는 사람(메뉴 권한·실험실 배정). `readable` = 진행 중인 보고서를 이 사람이 열 수 있는가(참여자·원장 — 목록과 같은 판정).
 */
export async function studentReportEntry(studentId: string): Promise<
  { pending: { id: string; readable: boolean } | null; canRequest: boolean } | null
> {
  const viewer = await reportViewer();
  if (!viewer) return null;
  const { data, error } = await createAdminClient().from("withdrawal_reports")
    .select("id,tenant_id,student_id,requested_by,teacher_id,manager_id,director_id,manager_ids,director_ids,status,group_leader,subjects")
    .eq("tenant_id", viewer.user.tenantId).eq("student_id", studentId).not("status", "in", "(completed,canceled)")
    .order("group_leader", { ascending: false }).order("created_at", { ascending: false }).limit(20);
  if (missingReportSchema(error)) return null;
  if (error) throw new Error("진행 중인 퇴원보고서를 확인하지 못했습니다.");
  const rows = (data ?? []) as ReportListRow[];
  const mine = rows.find(r => canReadReport(r, viewer));
  const pending = mine ? { id: mine.id, readable: true } : rows[0] ? { id: rows[0].id, readable: false } : null;
  return { pending, canRequest: viewer.request };
}

export async function reportSubjectLabels() {
  const settings = await getTenantSettings();
  return subjectLabelRecord(settings.operations.subjects);
}
