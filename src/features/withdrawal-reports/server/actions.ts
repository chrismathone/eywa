"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { pokeSlack } from "@/features/slack/server/poke";
import { describeDbError } from "@/lib/supabase/db-error";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { CANCEL_REASON_MAX, bodySchema, batchRequestSchema, cancelsAsDirector, directSchema, managerStepSkipped, submissionError, missingReportSchema, REPORT_ACTION_LABEL, type ReportAction, type ReportBody, type WithdrawalReport } from "../model";
import { checkReasonInput } from "@/features/withdrawals/reason-detail";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { reportViewer, getReport, getReportForSave } from "./queries";
import { decideReportApprovals } from "./request-check";
import { completedEnrollmentIds } from "./completed-target";
import { appliedAuditMeta } from "../audit-meta";
import { loadReportBilling } from "./billing";
import { withoutBillingFields } from "../prefill";
import { REPORT_UNCONFIRMED_LIMIT } from "../autosave";
import { applyDirectNow } from "./direct-apply";
import { REFUND_GATE_NOT_READY, loadGroupRefundCheck, refundGateReady } from "./refund-check";
import { loadRefundSteps } from "./refund-steps";

export type ReportResult = { ok: true; id: string } | { error: string };
function refresh() {
  for (const path of ["/withdrawal-reports", "/withdrawals", "/students", "/timetable", "/dashboard"]) revalidatePath(path, "layout");
}
async function finish(r: WithdrawalReport, action: keyof typeof REPORT_ACTION_LABEL, extra: Record<string, unknown> = {}) {
  // 이 승인으로 퇴원·수강 종료가 끝났으면 끝낸 수강을 함께 남긴다(appliedAuditMeta). 못 읽어도 기록을 먼저 남기고 종전처럼 실패를 알린다.
  let endedIds: string[] | null = null, endedError: unknown = null;
  if (r.status === "completed") { try { endedIds = await completedEnrollmentIds(r); } catch (e) { endedError = e; } }
  // 관리자 승인을 생략한 보고서의 제출 = 승인(원장 2026-11-03) — 기록에서 그렇게 읽히게.
  const operation = action === "submit" && managerStepSkipped(r) ? `${REPORT_ACTION_LABEL.submit} · 관리자 승인 생략` : REPORT_ACTION_LABEL[action];
  await logAction({ action: "withdrawal_report_update", targetType: "student", targetLabel: r.snapshot.name,
    metadata: { reportId: r.id, operation, date: r.effective_date, ...appliedAuditMeta(r, endedIds), ...extra } });
  if (action !== "save") pokeSlack(r.tenant_id);
  if (r.status === "completed") {
    if (!endedIds) throw endedError;
    await recordMathWithdrawalToSheet({ tenantId: r.tenant_id, studentId: r.student_id, date: r.effective_date, enrollmentIds: endedIds });
  }
  refresh();
}
export async function requestWithdrawalReport(input: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "보고서 작성 요청 권한이 없습니다." };
  const parsed = batchRequestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요." };
  if (viewer.scope && parsed.data.subjects.some(s => !viewer.scope!.includes(s))) return { error: "담당 과목의 보고서만 요청할 수 있습니다." };
  // 작성 강사·보고서마다 승인 관리자(원장 2026-11-03 — 작성 강사가 그 보고서 과목의 관리자면 관리자 승인 생략) — 요청 창과 같은 계산으로 서버가 정한다(화면 명단을 믿지 않는다).
  const decision = await decideReportApprovals(viewer.user.tenantId, parsed.data)
    .catch((): { ok: false; error: string } => ({ ok: false, error: "승인 관리자를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }));
  if (!decision.ok) return { error: decision.error };
  const db = createAdminClient();
  const { data, error } = await db.rpc("request_withdrawal_report_group", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id,
    p_payload: { ...parsed.data, teacherIds: decision.teacherIds, managerIds: decision.managerIds, reportManagerIds: decision.byTeacher },
  });
  if (error) return { error: missingReportSchema(error) ? "퇴원보고서 기능을 준비 중입니다." : error.code === "23505" ? "이 학생의 진행 중인 보고서가 있습니다. 기존 요청을 먼저 확인해 주세요." : describeDbError(error, { fallback: "보고서 작성을 요청하지 못했습니다." }).message };
  const { data: report, error: readError } = await db.from("withdrawal_reports").select("*").eq("tenant_id", viewer.user.tenantId).eq("group_id", data).eq("group_leader", true).single();
  if (readError || !report) { refresh(); return { error: "요청은 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요." }; }
  // 감사로그 — 어느 보고서가 관리자 승인 생략인지 · 나머지 보고서는 누가 승인하는지(원장 2026-11-03).
  await finish(report, "request", { ...(decision.skipped.length ? { managerSkipped: decision.skipped } : {}), approvers: decision.approvers });
  return { ok: true, id: report.id };
}
/**
 * **관리자 바로 처리**(강사 작성 없이 바로 퇴원·수강종료) — 원장 2026-10-23 *"대신 관리자가 어느 학생에 대해 퇴원보고서 카드에서
 * '강사 작성 없이 바로 퇴원(수강종료)' 가능하게"*. 권한 = 작성 요청(관리자·원장 역할 + 퇴원보고서 쓰기 · 강사뷰·읽기 전용 보기 불가)
 * **+ 원생 상태 변경 자격**(`canManageStudentStatusNow` — 승인을 건너뛰므로 예전 직접 퇴원과 같은 자격 · DB도 같은 명단을 본다).
 * DB 함수가 보고서 기록 한 건(누가 · 언제 · 사유)을 남기고, 처리일이 오늘 이전이면 승인된 보고서와 **같은 처리 함수**로 바로 퇴원·수강종료한다
 * (미래면 처리 예약 — 그날 00:05 cron). 강사에게 작성 요청 알림·할 일은 만들지 않는다. 감사로그는 남긴다(`finish`).
 */
export async function processWithdrawalDirectly(input: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "퇴원보고서를 바로 처리할 권한이 없습니다." };
  if (!(await canManageStudentStatusNow())) return { error: "원생 상태 변경을 맡은 사람만 바로 처리할 수 있습니다." };
  const parsed = directSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요." };
  const reason = checkReasonInput({ reason: parsed.data.reason, detail: parsed.data.reasonDetail, memo: parsed.data.memo });
  if (reason.error !== undefined) return { error: reason.error };
  // 다니는 반이 없는 학생은 과목으로 범위를 가를 수 없다 — 과목 범위가 걸린 사람은 처리하지 않는다(DB도 같은 규칙).
  if (viewer.scope && parsed.data.enrollmentIds.length === 0) return { error: "담당 과목의 원생만 처리할 수 있습니다." };
  // 바로 처리는 보고서를 만드는 함수가 안에서 처리까지 부른다 — DB가 준비되지 않았으면 **부르기 전에** 거절(리뷰 #5).
  try { if (!(await refundGateReady())) return { error: REFUND_GATE_NOT_READY }; }
  catch (e) { console.error("[withdrawal-report-gate-ready]", e); return { error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
  const db = createAdminClient();
  const { data, error } = await db.rpc("direct_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id,
    p_payload: { studentId: parsed.data.studentId, enrollmentIds: parsed.data.enrollmentIds, effectiveDate: parsed.data.effectiveDate,
      reason: parsed.data.reason, reasonDetail: reason.detail ?? "", memo: parsed.data.memo },
  });
  if (error) return { error: missingReportSchema(error) ? "바로 처리 기능을 준비 중입니다." : error.code === "23505" ? "이 학생의 진행 중인 보고서가 있습니다. 기존 보고서를 먼저 확인해 주세요." : describeDbError(error, { fallback: "바로 처리하지 못했습니다." }).message };
  const { data: report, error: readError } = await db.from("withdrawal_reports").select("*").eq("tenant_id", viewer.user.tenantId).eq("id", data as string).single();
  if (readError || !report) { refresh(); return { error: "처리는 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요." }; }
  const done = await applyDirectNow(report as WithdrawalReport, viewer.user.id);
  await finish(done.report, "direct", done.extra);
  return { ok: true, id: done.report.id };
}
export async function changeWithdrawalReport(id: string, action: ReportAction, revision: number, input?: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 보고서를 수정할 수 없습니다." };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["save", "submit", "approve", "reject", "cancel"].includes(action) || !Number.isSafeInteger(revision)) return { error: "요청 내용을 확인해 주세요." };
  const record = await getReport(id);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  if (action === "cancel" && record.report.requested_by !== viewer.user.id && !cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId))
    return { error: "작성 요청을 보낸 사람이나 원장만 취소할 수 있습니다." };
  // 취소는 본문과 상관없다 — 화면이 본 상태 그대로면 서버가 방금 읽은 revision으로 처리한다(2026-11-05 재리뷰: 강사가 쓰는 동안
  // 자동 저장이 revision을 계속 올려 요청자 · 원장의 취소가 '보고서가 변경되었습니다'로 거절됐다). 상태가 바뀌었으면(그사이 제출 · 승인)
  // 화면의 revision 그대로 보내 DB가 거절한다 — 새로 보고 다시 판단하게.
  const seenStatus = action === "cancel" && input && typeof input === "object" ? (input as { seenStatus?: unknown }).seenStatus : undefined;
  const payload: { revision: number; body?: unknown; comment?: string; refundCheck?: unknown } = { revision: seenStatus === record.report.status ? record.report.revision : revision };
  if (action === "save" || action === "submit") {
    const body = await reportBodyFor(record, input, action === "submit");
    if ("error" in body) return body;
    payload.body = body.body;
  }
  if (action === "reject") {
    if (typeof input !== "string" || !input.trim() || input.trim().length > 1000) return { error: "반려 사유를 1~1,000자로 작성해 주세요." };
    payload.comment = input.trim();
  }
  // 요청 취소 사유(원장 2026-11-06 *"요청 취소시에 '사유' 입력할 수 있고 마우스 올리면 사유 확인가능하게"*) — 필수 · 앞뒤 공백 빼고 1~500자.
  // DB(s2_0037)는 사유가 오면 같은 검사로 묶음의 모든 보고서 이력 'cancel' 줄에 남긴다(오지 않으면 종전처럼 — 옛 앱 호환은 DB 몫).
  const cancelReason = action === "cancel" ? cancelReasonOf(input) : null;
  if (action === "cancel") {
    if (!cancelReason) return { error: `취소 사유를 1~${CANCEL_REASON_MAX.toLocaleString("ko-KR")}자로 작성해 주세요.` };
    payload.comment = cancelReason;
  }
  // 원장 환불 결정(원장 2026-11-06 · s2_0037) — 제출·승인은 전원 승인으로 이어질 수 있다. **이 요청 안에서** 묶음의 환불 확인 값을 계산해 함께 넘긴다:
  // DB가 결정 안 된 환불 가능 줄을 세어 '환불 결정 대기'를 맞추고(원장 알림·할 일), 전원 승인이어도 0이 아니면 처리하지 않는다.
  // 못 만들면 처리를 맡기지 않는다(확인 값 없이 보내면 DB는 처리하지 않지만, 승인만 기록되고 처리는 다음 날로 밀린다 — 여기서 멈추고 다시 하게).
  if ((action === "submit" || action === "approve") && record.report.group_id) {
    // 새 앱 + 옛 DB(s2_0037 전)면 처리 함수가 확인 값을 모른 채 처리한다 — 부르지 않는다(리뷰 #5).
    try { if (!(await refundGateReady())) return { error: REFUND_GATE_NOT_READY }; }
    catch (e) { console.error("[withdrawal-report-gate-ready]", e); return { error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
    try { payload.refundCheck = await loadGroupRefundCheck(viewer.user.tenantId, record.report.group_id); }
    catch (e) { console.error("[withdrawal-report-refund-check]", e); return { error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
  }
  const { data, error } = await createAdminClient().rpc("transition_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_report: id, p_action: action, p_payload: payload,
  }).single();
  if (error) return { error: describeDbError(error, { fallback: "보고서 처리를 완료하지 못했습니다." }).message };
  const changed = data as WithdrawalReport;
  // 취소 — DB가 미완료 데스크 환불의 할 일을 취소하고 데스크 담당자에게 '환불 진행 전 확인'을 보냈다(s2_0025 · 요청서는 남긴다). 기록에도 남긴다.
  const extra = action === "cancel" ? { cancelReason, ...await cancelRefundAudit(changed) }
    : action === "submit" || action === "approve" ? await approvalRefundWait(changed).catch(() => ({})) : {};
  await finish(changed, action, { ...extra, ...await teacherViewMeta(viewer.user) });
  return { ok: true, id };
}

/**
 * 승인(제출)으로 전원 승인이 됐는데 묶음이 처리되지 않고 기다리면 그 까닭(리뷰 #8 · 감사로그 `refundWait`) — 원장 환불 결정 대기 · 데스크 환불·처리 확인 대기.
 * 기록용이라 못 읽으면 빈 값.
 */
async function approvalRefundWait(r: WithdrawalReport): Promise<{ refundWait?: string }> {
  if (!r.group_id || r.status !== "approved") return {};
  const db = createAdminClient();
  const [{ data: g }, { data: rs }, steps] = await Promise.all([
    db.from("withdrawal_report_groups").select("status,refund_hold").eq("tenant_id", r.tenant_id).eq("id", r.group_id).maybeSingle(),
    db.from("withdrawal_reports").select("status").eq("tenant_id", r.tenant_id).eq("group_id", r.group_id).limit(30),
    loadRefundSteps(r.tenant_id, [r]).then(map => map.get(r.group_id!) ?? [], () => null),
  ]);
  const group = g as { status: string; refund_hold?: boolean } | null;
  if (!group || group.status !== "pending" || (rs ?? []).some(x => x.status !== "approved")) return {};
  // 까닭을 모두 · 결정·데스크 대기가 아니면 DB가 확인 값을 '모름'(낡음·범위 다름)으로 보류한 것 — 다음 확인(00:05) 때 다시 판정(리뷰 r2 m6).
  const desk = steps === null ? null : steps.some(s => !s.completedDate);
  const parts = [...(group.refund_hold ? ["원장 환불 결정 대기"] : []), ...(desk ? ["데스크 환불 대기"] : [])];
  return { refundWait: parts.length ? parts.join(" · ") : desk === null ? "데스크 환불 확인 실패 · 처리 확인 대기" : "처리 확인 대기(확인 값 낡음 — 다음 확인 때 다시 판정)" };
}

/** 취소 입력의 사유 — `{ reason }`의 앞뒤 공백을 뺀 1~500자(아니면 null). */
function cancelReasonOf(input: unknown): string | null {
  const raw = input && typeof input === "object" ? (input as { reason?: unknown }).reason : undefined;
  const reason = typeof raw === "string" ? raw.trim() : "";
  return reason && Array.from(reason).length <= CANCEL_REASON_MAX ? reason : null;
}

/** 작성 칸만 검사 형식으로(수납 칸 빼고) — 저장 본문 · 충돌 판정이 같은 값을 본다. */
function writtenBody(input: unknown): { written: ReportBody } | { error: string } {
  const parsed = bodySchema.safeParse(withoutBillingFields(input));
  return parsed.success ? { written: parsed.data } : { error: parsed.error.issues[0]?.message ?? "보고서 내용을 확인해 주세요." };
}
/** 작성·제출 본문 — 화면 값 검사(제출이면 제출 기준까지) · 연결할 수 있는 상담만 · 수납 칸은 서버가 지금 장부로 채운다. */
type BodyRecord = { report: WithdrawalReport; consultations: readonly { id: string }[] };
/** 저장·제출 본문 — 작성 칸 검사 + 연결 상담 확인 + 수납은 지금 장부. `retry` = 다시 하면 될 수 있는 실패(장부 조회). */
async function reportBodyFor(record: BodyRecord, input: unknown, submit: boolean): Promise<{ body: unknown; written: ReportBody } | { error: string; retry?: boolean }> {
  const parsed = writtenBody(input);
  if ("error" in parsed) return parsed;
  const written = parsed.written;
  if (submit) { const error = submissionError(written); if (error) return { error }; }
  const existing = record.report.body.consultationIds ?? [];
  if (written.consultationIds?.some(id => !existing.includes(id) && !record.consultations.some(c => c.id === id))) return { error: "연결할 수 없는 상담기록이 포함되어 있습니다." };
  try { return { body: { ...written, ...await loadReportBilling(record.report) }, written }; }
  catch { return { error: "수납 정보를 확인하지 못했습니다. 잠시 후 다시 저장해 주세요.", retry: true }; }
}

/** 작성 칸(수납 칸 빼고)이 같은가 — 검사 형식을 거친 값끼리 비교한다(칸 순서가 같다). */
function sameWrittenBody(stored: unknown, written: ReportBody): boolean {
  const parsed = bodySchema.safeParse(withoutBillingFields(stored));
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(written);
}

/**
 * 강사뷰 전환으로 대신 쓴 처리인가(원장 2026-11-05 — 부재 강사의 보고서를 관리자가 강사뷰로 들어가 대신 작성) — 처리 이력·DB 행위자는
 * 그 강사(작성 강사 본인만 쓸 수 있다), 감사로그 행위자는 실제 로그인 계정이다. 둘이 다르면 누구 화면에서 했는지 기록에 남긴다.
 */
async function teacherViewMeta(actingAs: { id: string; displayName: string }): Promise<Record<string, unknown>> {
  const real = await getCurrentUser();
  return real && real.id !== actingAs.id ? { teacherViewAs: actingAs.displayName } : {};
}

export type AutosaveResult = { ok: true; revision: number; savedAt: string } | { ok: false; conflict: boolean; error: string; retry?: boolean };
const AUTOSAVE_AUDIT_WINDOW_MS = 10 * 60 * 1000;
const AUTOSAVE_OPERATION = "자동 저장";

/**
 * **자동 저장**(원장 2026-11-05 *"퇴원보고서도 실시간으로 입력되고 저장되게"*) — 작성 칸을 고치면 화면의 자동 저장기(`autosave.ts`)가 잠시 뒤 부른다.
 * 검사와 DB 처리는 'save'와 같다(`transition_withdrawal_report` 'save' — 작성 강사 본인 · 작성 단계만 · revision 대조). 다른 점 셋:
 * - 화면을 다시 그리지 않는다(`refresh` 안 함) — 고칠 때마다 다섯 경로를 다시 그리면 무겁고 쓰던 칸이 흔들린다. 바뀐 revision만 돌려준다.
 * - 감사로그는 그 보고서를 같은 사람이 10분 안에 이어 자동 저장하면 새 줄을 남기지 않는다(시간표 메모 시트와 같은 규칙).
 *   DB 처리 이력도 같은 규칙으로 줄을 아낀다(s2_0025 — 마지막 이력이 같은 사람의 10분 안 '임시 저장'이면 새 줄을 넣지 않는다).
 * - revision이 다르면(다른 화면이 먼저 고침) `conflict` — 자동 저장기가 멈추고 새로고침을 안내한다(내 글로 덮지 않는다).
 *   단 서버 글이 지금 글이거나 결과를 모르던 내 글(`unconfirmed`)이면 응답만 끊긴 내 저장이다 — 받아들이거나 그 위에 이어 쓴다.
 */
export async function autosaveWithdrawalReport(id: string, revision: number, input: unknown, unconfirmed: unknown = []): Promise<AutosaveResult> {
  const viewer = await reportViewer();
  if (!viewer?.writable) return { ok: false, conflict: false, error: "이 화면에서는 보고서를 수정할 수 없습니다." };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(revision)) return { ok: false, conflict: false, error: "요청 내용을 확인해 주세요." };
  const ids = input && typeof input === "object" && Array.isArray((input as { consultationIds?: unknown }).consultationIds)
    ? ((input as { consultationIds: unknown[] }).consultationIds).filter((c): c is string => typeof c === "string") : [];
  let record: Awaited<ReturnType<typeof getReportForSave>>;
  // 조회 오류는 다시 보낼 실패 — 없음 · 볼 수 없음만 다시 해도 같은 거절이다(2026-11-05 재리뷰).
  try { record = await getReportForSave(id, ids); }
  catch { return { ok: false, conflict: false, error: "서버에서 오류가 났습니다.", retry: true }; }
  if (!record) return { ok: false, conflict: false, error: "보고서에 접근할 수 없습니다." };
  const current = writtenBody(input);
  if ("error" in current) return { ok: false, conflict: false, error: current.error };
  let base = revision;
  if (record.report.revision !== revision) {
    // revision이 다르면 상담 검사 · 장부 조회 **전에** 판정한다(2026-11-05 재리뷰: 충돌이 검사 오류 · 장부 재시도에 가려졌다).
    // 앞선 내 저장이 들어갔는데 응답만 끊긴 경우(모바일 등)만 받아들인다 — 그 밖은 충돌(덮지 않는다).
    // - 서버 글 = 지금 보내는 글: 쓸 것 없이 그 revision을 받아들인다.
    // - 서버 글 = 결과를 모르던 내 글(`unconfirmed` — 저장 중 이어 쓴 경우): 서버 revision 위에 지금 글을 쓴다.
    const stored = record.report;
    const mine = stored.revision > revision && stored.teacher_id === viewer.user.id && ["requested", "revision"].includes(stored.status);
    if (mine && sameWrittenBody(stored.body, current.written)) return { ok: true, revision: stored.revision, savedAt: stored.updated_at };
    const earlier = Array.isArray(unconfirmed) ? unconfirmed.slice(-REPORT_UNCONFIRMED_LIMIT) : [];
    const landed = mine && earlier.some((b) => { const w = writtenBody(b); return "written" in w && sameWrittenBody(stored.body, w.written); });
    if (!landed) return { ok: false, conflict: true, error: "다른 화면에서 이 보고서가 바뀌었습니다." };
    base = stored.revision;
  }
  const body = await reportBodyFor(record, input, false);
  if ("error" in body) return { ok: false, conflict: false, error: body.error, retry: body.retry };
  const { data, error } = await createAdminClient().rpc("transition_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_report: id, p_action: "save", p_payload: { revision: base, body: body.body },
  }).single();
  if (error) {
    const message = describeDbError(error, { fallback: "서버에서 오류가 났습니다." }).message;
    // DB가 던진 검사(P0001 — 권한 · 작성 단계 · 칸)는 다시 해도 같다. 그 밖(연결 · 시간 초과 등)은 다시 보낸다.
    return { ok: false, conflict: /보고서가 변경되었습니다/.test(error.message ?? ""), error: message, retry: error.code !== "P0001" };
  }
  const saved = data as WithdrawalReport;
  const realUser = await getCurrentUser();
  const meta = await teacherViewMeta(viewer.user);
  after(async () => {
    if (!realUser) return;
    const since = new Date(Date.now() - AUTOSAVE_AUDIT_WINDOW_MS).toISOString();
    const { data: recent } = await createAdminClient().from("audit_logs").select("id")
      .eq("tenant_id", saved.tenant_id).eq("actor_id", realUser.id).eq("action", "withdrawal_report_update")
      .eq("metadata->>reportId", saved.id).eq("metadata->>operation", AUTOSAVE_OPERATION).gte("created_at", since).limit(1);
    if (recent?.length) return;
    await logAction({ action: "withdrawal_report_update", targetType: "student", targetLabel: saved.snapshot.name,
      metadata: { reportId: saved.id, operation: AUTOSAVE_OPERATION, date: saved.effective_date, revision: saved.revision, ...meta } });
  });
  return { ok: true, revision: saved.revision, savedAt: saved.updated_at };
}
/**
 * 취소한 묶음의 데스크 환불(원장 2026-11-03) — DB가 같은 거래에서 연결된 요청서마다 데스크에 알렸다(끝나지 않은 요청서 = 할 일 취소 + '환불 진행 전 확인',
 * 끝난 요청서 = 처리한 사람에게 '환불 확인 필요' · 취소한 본인·퇴사자 제외 · s2_0025 `withdrawal_report_refunds_on_cancel`). **실제로 알린 대상**은 DB가 보고서 처리 이력
 * 'refund_notice'로 남긴다 — 취소 줄과 같은 거래 시각인 그 줄들을 읽어 감사로그에 싣는다(앱이 규칙을 따로 흉내 내지 않게). 못 읽으면 그 사실만 적는다.
 */
async function cancelRefundAudit(r: WithdrawalReport): Promise<Record<string, unknown>> {
  try {
    const db = createAdminClient();
    const ids = r.group_id
      ? ((await db.from("withdrawal_reports").select("id").eq("tenant_id", r.tenant_id).eq("group_id", r.group_id)).data ?? []).map(x => String(x.id))
      : [r.id];
    const { data, error } = await db.from("withdrawal_report_events").select("action,comment,created_at")
      .eq("tenant_id", r.tenant_id).in("report_id", ids.length ? ids : [r.id]).in("action", ["cancel", "refund_notice"]).order("created_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const at = (data ?? []).find(e => e.action === "cancel")?.created_at;
    const notified = (data ?? []).filter(e => e.action === "refund_notice" && e.created_at === at).map(e => String(e.comment ?? ""));
    return notified.length ? { deskRefundsNotified: notified } : {};
  } catch (e) {
    console.error("[withdrawal-report-cancel-audit]", e);
    return { deskRefunds: "알린 데스크 확인 실패" };
  }
}
