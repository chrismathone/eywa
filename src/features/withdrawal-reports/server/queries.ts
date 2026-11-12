import "server-only";
import { cache } from "react";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { isLaboratoryMenuAvailable } from "@/lib/laboratory/server";
import { getViewerStaffScope } from "@/features/staff/department/server/subject-scope";
import { getTenantSettings } from "@/features/owner/server/queries";
import { EMPTY_BODY, cancelsAsDirector, canRequestRefund, canRequestReport, isBookkeepingReport, isParticipant, missingReportSchema, snapshotMatches, type RefundStep, type ReportStatus, type StudentSnapshot, type WithdrawalReport, type ReportListRow, type ReportEvent, type StaffOption, type StudentOption, type CourseSnapshot } from "../model";
import { kstToday } from "@/lib/date-kst";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { protectedAccountIds } from "@/lib/auth/protected-accounts";
import { displayRoleFor } from "@/lib/auth/super-admin";
import { staffSubjectScopeOf } from "@/features/staff/department/subject-scope";
import { loadReportPrefill } from "./prefill";
import { loadReportBilling } from "./billing";
import { loadDeskStaff, loadLaterInvoices, type LaterInvoice } from "./refund";
import { loadRefundDecisions, loadRefundHoldState, loadRefundOutcomes, refundGateReady } from "./refund-check";
import { DESK_NOT_DESIGNATED, declinedKeys, lineDeductions, openClaims, refundHoldGap, refundableKeys, undecidedKeys, type RefundDecision, type RefundHoldState } from "../refund-decision";
import type { LaterState, OthersState } from "../refund-detail-notes";
import type { RefundOutcome } from "../approval-lines";
import { loadRefundSteps } from "./refund-steps";
import { fetchInChunks } from "@/lib/supabase/batch";
import { liveBillingForSubmitted } from "../prefill";
import { reportConsultations } from "./consultations";
import type { SubjectHistoryRow } from "../course-period";
import { reportCourses, withUnassignedCourses } from "../target-courses";
import { isReportOptout } from "@/features/classes/report-optout";
import { narrowApprovalSubjects } from "../request-options";
import { foldedReason } from "@/lib/folded-read";
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
export async function currentSnapshot(tenant: string, student: string): Promise<StudentSnapshot | null> {
  const { data, error } = await createAdminClient().from("students").select(`name,school,grade,enrolled_at,status,withdrawn_at,enrollments(${COURSE_COLUMNS})`).eq("tenant_id", tenant).eq("id", student)
    .eq("enrollments.tenant_id", tenant).eq("enrollments.classes.tenant_id", tenant).eq("enrollments.classes.teacher.tenant_id", tenant).maybeSingle();
  if (error) throw new Error("현재 학생·담당 강사를 확인하지 못했습니다.");
  return data ? { name: data.name, school: data.school, grade: data.grade, enrolledAt: data.enrolled_at, status: data.status, withdrawnAt: data.withdrawn_at, courses: currentCourses(data.enrollments as unknown as JoinedCourse[]) } : null;
}
export async function listReports() {
  const viewer = await reportViewer();
  if (!viewer) return { rows: [] as ReportListRow[], available: false, completedLimited: false, groupStatuses: undefined };
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
    if (missingReportSchema(error)) return { rows: [], available: false, completedLimited: false, groupStatuses: undefined };
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
  return { rows, available: true, completedLimited: completedLimited || completed.length > 200, groupStatuses: await groupStatusesOf(viewer.user.tenantId, rows) };
}
/**
 * 승인 완료(approved) 줄의 묶음 형제 상태 — 목록 상태 칸이 '다른 과목 승인 대기'(2단계)와 '환불·처리만 남음'(3단계)을 가른다
 * (리뷰 2026-11-06 — 형제가 열람 범위 밖이라 목록에 없어도). 묶음 id로 상태 한 칸만 한 번 더 읽는다(본문·이름은 읽지 않는다).
 * 못 읽으면 undefined — 목록에 보이는 형제로만 판정한다(목록은 연다).
 */
export async function groupStatusesOf(tenantId: string, rows: readonly ReportListRow[]): Promise<Map<string, { id: string; status: ReportStatus }[]> | undefined> {
  const groupIds = [...new Set(rows.filter(r => r.status === "approved" && r.group_id).map(r => r.group_id!))];
  const out = new Map<string, { id: string; status: ReportStatus }[]>();
  if (!groupIds.length) return out;
  try {
    const db = createAdminClient();
    const found = await fetchInChunks<{ id: string; group_id: string; status: ReportStatus }>(groupIds, async chunk =>
      (await db.from("withdrawal_reports").select("id,group_id,status").eq("tenant_id", tenantId).in("group_id", chunk)) as unknown as { data: { id: string; group_id: string; status: ReportStatus }[] | null; error: { message: string } | null });
    for (const r of found) out.set(r.group_id, [...(out.get(r.group_id) ?? []), { id: r.id, status: r.status }]);
    return out;
  } catch (error) {
    console.error("[withdrawal-reports] 묶음 형제 상태 조회 실패", error);
    return undefined;
  }
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
  // `computed` = 지금 계산을 실제로 했나(못 읽음 · 수납을 못 보는 열람자 · 결정 표 조회 실패면 false) — 목록 표시와의 어긋남(리뷰 r2 (b))은 계산했을 때만 말한다.
  // `laterState` = 칸이 '없음'이라고 말해도 되나(리뷰 r2 I3) — 조회 실패 · 수납 열람권 없음이면 '없음' 대신 그 사실을 보인다(결정 위치·어긋남 안내도 띄우지 않는다).
  let computed = data.status !== "canceled" && billingOk;
  let laterState: LaterState = billingOk ? "ok" : "hidden";
  const laterInvoices: LaterInvoice[] = data.status === "canceled" || !billingOk ? []
    : await loadLaterInvoices(data as WithdrawalReport).catch((e) => { console.error("[withdrawal-report-later-invoices]", e); computed = false; laterState = e instanceof Error && e.name === "LaterLimitError" ? "limit" : "failed"; return []; });
  // 데스크 담당자 목록은 환불을 승인할 수 있는 원장급에게만(이름 목록을 다른 사람에게 내리지 않는다) — 권한 판정 한 곳 `canRequestRefund`
  // · 후보 = 학원 설정 '데스크 담당자' 중 수납 쓰기 권한이 있는 직원(`loadDeskStaff` · 원장 2026-11-06) · 자기 자신은 빼고(자기 알림은 가지 않음 — notifyUsers).
  //   지정이 비었으면 고를 사람이 없다 — 안내(`deskNotice`)로 환불 승인을 막는다(원장 등으로 대신하지 않는다).
  // 데스크 환불 단계(s2_0025)·원장 환불 결정(s2_0037 — 줄마다 결정 · 묶음의 '환불 결정 대기' 표시)은 함께 읽는다 — 못 읽으면 없이(화면은 연다).
  const refundAllowed = canRequestRefund(data as WithdrawalReport, viewer.writable, cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId));
  const groupId = (data as WithdrawalReport).group_id ?? null;
  const refundable = refundableKeys(laterInvoices);
  // 부가 조회 실패는 '없음'으로 접지 않는다(리뷰 r3 R2-m10) — 안내가 사실대로 말하고, 결정 기록·대기 표시를 못 읽었으면 결정 단추를 막는다.
  const failed = { decisions: false, hold: false, steps: false };
  const [desk, refundSteps, decisions, holdState, outcomes, siblings, gateReady] = await Promise.all([
    refundable.length && refundAllowed
      ? loadDeskStaff(viewer.user.tenantId).then(d => ({ staff: d.staff.filter(s => s.id !== viewer.user.id), designated: d.designated, folded: d.folded, failed: false }),
        (e: unknown) => { console.error("[withdrawal-report-desk-staff]", e); return { staff: [] as DeskOption[], designated: true, folded: false, failed: true }; })
      : Promise.resolve({ staff: [] as DeskOption[], designated: true, folded: false, failed: false }),
    loadRefundSteps(viewer.user.tenantId, [data as WithdrawalReport]).then(map => map.get(data.group_id ?? data.id) ?? [], (e: unknown) => { console.error("[withdrawal-report-refund-steps]", e); failed.steps = true; return [] as RefundStep[]; }),
    groupId ? loadRefundDecisions(viewer.user.tenantId, groupId).catch((e: unknown) => { console.error("[withdrawal-report-refund-decisions]", e); computed = false; failed.decisions = true; return new Map<string, RefundDecision>(); }) : Promise.resolve(new Map<string, RefundDecision>()),
    // DB '환불 결정 대기' 표시 한 벌(목록 칩과 같은 칸 · 결정 보고서 · 마지막 판정 시각) — 못 읽으면 모름(null · 대기 없음으로 보이고 어긋남은 말하지 않는다).
    groupId ? loadRefundHoldState(viewer.user.tenantId, groupId).catch((e: unknown) => { console.error("[withdrawal-report-refund-hold]", e); failed.hold = true; return null; }) : Promise.resolve(null as RefundHoldState | null),
    groupId ? loadRefundOutcomes(viewer.user.tenantId, [groupId]).catch((e: unknown) => { console.error("[withdrawal-report-refund-outcomes]", e); return new Map<string, RefundOutcome>(); }) : Promise.resolve(new Map<string, RefundOutcome>()),
    // 같은 묶음 보고서(상태 · 대표 · 열람 판정 칸) — 승인 완료 안내('다른 과목 승인' · 리뷰 r2 m5·m6)와 결정할 줄을 보이는 다른 보고서 링크(리뷰 r2 (b)). 못 읽으면 null(모름).
    groupId ? groupSiblings(viewer.user.tenantId, groupId) : Promise.resolve([] as SiblingRow[]),
    // 관문 SQL 적용 여부 — 취소 확인 칸이 '사유는 처리 이력에 남는다'고 말해도 되나(리뷰 r2 m13). 못 읽으면 모름(false 쪽 문구).
    refundGateReady().catch(() => false),
  ]);
  const deskNotice = !refundAllowed || !refundable.length ? undefined
    : desk.failed ? "데스크 담당자를 불러오지 못했습니다. 새로고침해 주세요."
    // 학원 설정을 못 읽어 기본값으로 접혔다 — 지정이 비어 보여도 '지정하세요'로 헛걸음시키지 않는다(리뷰 r2 m7).
    : desk.folded ? "학원 설정을 불러오지 못했습니다. 새로고침해 주세요."
    : !desk.designated ? DESK_NOT_DESIGNATED
    : !desk.staff.length ? "학원 설정에 지정된 데스크 담당자 중 고를 수 있는 사람(수납 쓰기 권한이 있고 본인이 아닌 사람)이 없습니다. 학원 설정에서 데스크 담당자를 다시 지정해 주세요."
    : undefined;
  // 원장 환불 결정(원장 2026-11-06) — 이 보고서 화면의 환불 가능 줄 중 결정 안 된 줄 · '환불하지 않음'으로 정한 줄 · 묶음의 대기 표시(목록 칩과 같은 값).
  // 결정 버튼·확인 값은 지금 계산 그대로 · 목록 표시(DB)와 어긋나면 `gap`으로 상세에 한 줄(리뷰 r2 (b) · `refundHoldGap`).
  const paidOf = new Map(laterInvoices.flatMap(inv => inv.lines.map(l => [l.key, l.paidNet] as const)));
  // 결정 안 된 줄 = 환불 가능 줄 중 결정 전 + 이 묶음 요청서가 담은 줄 중 다시 정할 것(결정 뒤 낸 돈이 늚 · 표식 키가 낡음 — DB note claimed 갈래와 같은 판정 · 리뷰 r2 D-2·D-4).
  // 결정 기록을 못 읽었으면 '결정 전'으로 세지 않는다(이미 정한 줄을 결정 전으로 보이지 않게 · 결정 단추는 막는다).
  const reopen = groupId && !failed.decisions ? openClaims(laterInvoices, decisions) : [];
  const undecided = failed.decisions ? [] : [...undecidedKeys(refundable, decisions, paidOf), ...reopen.map(o => o.key)];
  // 결정할 줄을 보이는 보고서(DB 표시 · 모르면 대표 보고서) — 이 보고서가 아니면 그 보고서로 바로 가는 링크(열 수 있을 때만 · 과목은 화면이 이름으로).
  const holdReportId = holdState?.hold ? holdState.report ?? siblings?.find(s => s.group_leader)?.id ?? null : null;
  const holdRow = holdReportId && holdReportId !== data.id ? siblings?.find(s => s.id === holdReportId) : undefined;
  const refundDecision = { hold: holdState?.hold ?? false, undecided, declined: declinedKeys(refundable, decisions), outcome: (groupId ? outcomes.get(groupId) : undefined) ?? null,
    gap: refundHoldGap(data as WithdrawalReport, holdState, undecided, computed),
    holdCount: holdState?.undecided ?? 0, laterState,
    holdReport: holdRow ? { id: holdRow.id, subjects: holdRow.subjects ?? [], readable: canReadReport(holdRow as ReportListRow, viewer) } : null,
    others: othersOf(data.id, siblings), gateReady, openClaims: reopen,
    // 줄별 뺄 몫(이전 환불 완료 기록 · 따로 환불 — 리뷰 r3 R2-I2) · 조회 실패(결정 단추 막음 — R2-m10).
    deductions: lineDeductions(laterInvoices, decisions), failed: failed.decisions || failed.hold, decisionsFailed: failed.decisions, lookupFailed: failed };
  return { report: data as WithdrawalReport, events: [...(events ?? [])].reverse() as ReportEvent[], assignmentChanged, consultations, laterInvoices, deskStaff: desk.staff, deskNotice, refundDecision, refundSteps, subjectHistory, ...prefill };
}
type DeskOption = { id: string; name: string; jobTitle?: string | null };
type SiblingRow = Pick<ReportListRow, "id" | "status" | "subjects" | "group_leader" | "teacher_id" | "requested_by" | "manager_id" | "director_id" | "manager_ids" | "director_ids">;
/** 같은 묶음 보고서(본문·이름 없이 상태·열람 판정 칸만) — 못 읽으면 null(모름). */
async function groupSiblings(tenantId: string, groupId: string): Promise<SiblingRow[] | null> {
  const { data, error } = await createAdminClient().from("withdrawal_reports").select("id,status,subjects,group_leader,teacher_id,requested_by,manager_id,director_id,manager_ids,director_ids")
    .eq("tenant_id", tenantId).eq("group_id", groupId).limit(30);
  if (error) { console.error("[withdrawal-report-siblings]", error.message); return null; }
  return (data ?? []) as SiblingRow[];
}
/** 다른 과목 보고서 승인 — 승인 전 형제가 있으면 pending · 못 읽었으면 unknown · 그 밖 done(목록 상태 칸과 같은 축 — 리뷰 r2 (a)). */
function othersOf(id: string, siblings: readonly SiblingRow[] | null): OthersState {
  if (!siblings) return "unknown";
  return siblings.some(s => s.id !== id && ["requested", "revision", "manager_pending", "director_pending"].includes(s.status)) ? "pending" : "done";
}
/**
 * 자동 저장용 가벼운 조회(원장 2026-11-05 실시간 저장 · 리뷰: 입력이 멈출 때마다 상세 전체 — 이력 300줄 · 스냅숏 · 수강 이력 · 장부 · 뒤 청구 ·
 * 환불 단계 — 를 다시 읽었다). 보고서 한 줄과, 새로 잇는 상담이 있을 때만 연결 가능한 상담 목록. 열람 규칙은 `getReport`와 같다.
 */
export async function getReportForSave(id: string, consultationIds: readonly string[]) {
  const viewer = await reportViewer();
  if (!viewer) return null;
  const { data, error } = await createAdminClient().from("withdrawal_reports").select(REPORT_COLUMNS).eq("tenant_id", viewer.user.tenantId).eq("id", id).maybeSingle();
  // 조회 오류는 던진다(자동 저장이 '다시 보낼 실패'로 받는다 — 2026-11-05 재리뷰). null = 없거나 볼 수 없음(다시 해도 같다).
  if (error) throw new Error(error.message);
  if (!data || !canReadReport(data as WithdrawalReport, viewer)) return null;
  const report = data as WithdrawalReport;
  const existing = report.body.consultationIds ?? [];
  const consultations = consultationIds.some(c => !existing.includes(c)) ? await reportConsultations(report, viewer) : [];
  return { report, consultations };
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
    .select("id,start_date,end_date,classes!inner(class_name,subject,is_special)")
    .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id)
    .in("classes.subject", subjects).lte("start_date", report.effective_date).order("start_date").limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).flatMap((row) => {
    const klass = row.classes as unknown as { class_name: string | null; subject: string | null; is_special: boolean | null } | null;
    if (!klass?.subject || !row.start_date) return [];
    return [{ enrollmentId: String(row.id), subject: klass.subject, className: (klass.class_name ?? "").trim() || "이름 없는 반", startDate: String(row.start_date).slice(0, 10), endDate: row.end_date ? String(row.end_date).slice(0, 10) : null, isSpecial: klass.is_special === true }];
  });
}
/**
 * 퇴원보고서 직원 목록(이름·직급·역할·승인 과목·'퇴원보고서 승인자' 표시).
 * `forRequest` = 작성 요청의 승인자를 정하는 자리(서버 `decideReportApprovals`) — 학원 설정을 못 읽었으면 던진다.
 * 목록·상세 화면(이름 표기 · 요청 창)은 설정을 못 읽어도 열린다 — 그때는 '명단 있음 + 아무도 지정 아님'으로 돌려 승인자가 나오지 않게 하고,
 * 요청 창이 '학원 설정을 확인하지 못했습니다'로 막는다(읽기는 열고 쓰기만 막는다 — 3차 재리뷰 2026-11-06 · 다른 접힌 설정 관례와 같다).
 * 승인·제출은 DB에 저장된 승인자로만 판정하므로 설정과 무관하다.
 */
export async function reportStaff(options: { forRequest?: boolean } = {}) {
  const viewer = await reportViewer();
  if (!viewer) return [] as StaffOption[];
  // job_title = 퇴원보고서 화면의 승인자 표기('정유진 부원장' — 원장 2026-11-05)에만 쓴다.
  const { data, error } = await createAdminClient().from("users").select("id,display_name,system_role,subjects,job_title")
    .eq("tenant_id", viewer.user.tenantId).eq("status", "active").in("system_role", ["teacher", "manager", "admin", "master"]).order("display_name");
  if (error) throw new Error("직원 목록을 불러오지 못했습니다.");
  const [protection, settings] = await Promise.all([protectedAccountIds((data ?? []).map(u => u.id)), getTenantSettings()]);
  if (protection.lookupFailed) throw new Error("직원 정보를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  // 🔴 학원 설정을 못 읽어 기본값으로 접혔으면 — 기본값의 '퇴원보고서 승인자'는 빈 명단이라 그대로 쓰면 '명단 없는 학원'으로 풀려
  //    지정 밖 승인자·승인 생략이 저장된다(리뷰 2026-11-06 2차). 작성 요청 자리는 멈추고(서버 액션이 '승인 관리자를 확인하지 못했습니다'로 막는다),
  //    화면 자리는 아무도 지정하지 않은 명단으로 돌려준다(아래 `folded`).
  const folded = !!foldedReason(settings);
  if (folded && options.forRequest) throw new Error("승인 관리자를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  // 🔴 침산 지점 superadmin(lsy93@gmail.com · st2000423@gmail.com 등)은 절대 승인자로 넣지 않는다 — 원장 칸에는 진짜 원장만(원장 2026-10-30).
  //    system_role이 master라 그대로 두면 원장 후보가 되고, DB도 관리자 칸은 막지 않는다. 표시 역할을 admin으로 바꿔 원장 후보에서,
  //    승인 과목을 비워 관리자 후보에서 뺀다(요청 화면에 superadmin 여부를 내려보내지 않는다). '퇴원보고서 승인자' 명단에 있어도 뺀다
  //    (지정 승인자는 과목과 무관하게 후보가 될 수 있어서 — `reportApprovalPlan`).
  //    원장급(master)은 관리자 승인 후보가 아니다(원장 2026-11-05 — `reportApprovalPlan`). 학원 설정 '퇴원보고서 승인자'가 있으면 그 사람들 중에서만(`narrowApprovalSubjects`).
  //    원본 명단이 비어 있지 않은데 유효한 사람이 0명(운영자 계정만 · 퇴사 · 평강사·원장급만)이면 '승인자 없음'으로 막는다(종전 동작으로 돌아가지 않는다 — 리뷰 2026-11-06).
  const listed = settings.permissions.specialAccess.withdrawalApproverIds ?? [];
  const approverIds = listed.filter(id => !protection.protectedIds.has(id));
  return narrowApprovalSubjects((data ?? []).map(u => ({ id: u.id, name: u.display_name, role: displayRoleFor(u.id, u.system_role, protection.protectedIds), subjects: u.subjects ?? [],
    jobTitle: typeof u.job_title === "string" && u.job_title.trim() ? u.job_title.trim() : null,
    approvalSubjects: protection.protectedIds.has(u.id) ? [] : staffSubjectScopeOf(u.id, settings.permissions.specialAccess.staffSubjectScopes) ?? u.subjects ?? [] })) as StaffOption[],
    folded ? [] : approverIds, folded || listed.length > 0);
}
/**
 * 작성 요청·바로 처리 창의 학생 선택지 — 재원·휴원 · 퇴원 예약 없음 · 시험 학생 제외.
 * `studentId`를 주면 그 학생 하나만(원생 화면 입구가 '다른 과목은 요청할 수 있나'를 볼 때 — 창과 같은 판정).
 * 지금 다니는 반이 없는 학생도 싣는다(`courses: []`) — 강사 작성 요청은 담임이 없어 못 하지만 **관리자 바로 처리**(퇴원만)는 된다
 * (원장 2026-10-23 · 창이 요청 모드에선 반 있는 학생만 보인다). 과목 범위가 걸린 사람에겐 담당 과목 반이 있는 학생만.
 */
export async function requestStudents(studentId?: string) {
  const viewer = await reportViewer();
  if (!viewer?.request) return [] as StudentOption[];
  const db = createAdminClient();
  const result: StudentOption[] = [];
  // 진행 중인 보고서를 못 읽어도 창은 연다 — 같은 과목 요청은 DB가 거절한다.
  const openReports = loadOpenReportScopes(viewer.user.tenantId, studentId).catch((e: unknown) => { console.error("[withdrawal-open-reports]", e); return new Map<string, OpenReportScope>(); });
  for (let offset = 0; ; offset += 400) {
    const base = db.from("students").select(`id,name,school,grade,enrollments(${COURSE_COLUMNS})`).eq("tenant_id", viewer.user.tenantId);
    const { data, error } = await (studentId ? base.eq("id", studentId) : base).eq("is_test", false).in("status", ["enrolled", "on_hold"]).is("withdrawn_at", null)
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
 * 🔴 과목이 다르면 따로 요청한다(s2_0014) — 진행 중인 보고서가 있어도 **다른 과목 반이 남아 있으면** `canRequest`(요청 창과 같은 판정
 *    `requestStudents(studentId)`). 2026-11-12 원장 제보: 영어 보고서가 진행 중인 학생의 수학 보고서를 원생 화면에서 못 열었다(입구가 영어 보고서로만 보냈다).
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
  // 진행 중인 보고서가 없으면 종전대로(조회를 더하지 않는다). 있으면 다른 과목 반이 남았는지 창과 같은 판정으로 — 못 읽으면 입구만 접는다(DB가 거절한다).
  const canRequest = viewer.request && (!rows.length || (await requestStudents(studentId).catch(() => [])).length > 0);
  return { pending, canRequest };
}

export async function reportSubjectLabels() {
  const settings = await getTenantSettings();
  return subjectLabelRecord(settings.operations.subjects);
}
