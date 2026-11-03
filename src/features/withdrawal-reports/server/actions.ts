"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { pokeSlack } from "@/features/slack/server/poke";
import { describeDbError } from "@/lib/supabase/db-error";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { bodySchema, batchRequestSchema, cancelsAsDirector, directSchema, managerStepSkipped, submissionError, missingReportSchema, REPORT_ACTION_LABEL, type ReportAction, type WithdrawalReport } from "../model";
import { checkReasonInput } from "@/features/withdrawals/reason-detail";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { reportViewer, getReport } from "./queries";
import { managerStepSkippable } from "./request-check";
import { completedEnrollmentIds } from "./completed-target";
import { appliedAuditMeta } from "../audit-meta";
import { loadReportBilling } from "./billing";
import { withoutBillingFields } from "../prefill";

export type ReportResult = { ok: true; id: string } | { error: string };
function refresh() {
  for (const path of ["/withdrawal-reports", "/withdrawals", "/students", "/timetable", "/dashboard"]) revalidatePath(path, "layout");
}
async function finish(r: WithdrawalReport, action: keyof typeof REPORT_ACTION_LABEL) {
  // 이 승인으로 퇴원·수강 종료가 끝났으면 끝낸 수강을 함께 남긴다(appliedAuditMeta). 못 읽어도 기록을 먼저 남기고 종전처럼 실패를 알린다.
  let endedIds: string[] | null = null, endedError: unknown = null;
  if (r.status === "completed") { try { endedIds = await completedEnrollmentIds(r); } catch (e) { endedError = e; } }
  // 관리자 승인을 생략한 보고서의 제출 = 승인(원장 2026-11-03) — 기록에서 그렇게 읽히게.
  const operation = action === "submit" && managerStepSkipped(r) ? `${REPORT_ACTION_LABEL.submit} · 관리자 승인 생략` : REPORT_ACTION_LABEL[action];
  await logAction({ action: "withdrawal_report_update", targetType: "student", targetLabel: r.snapshot.name,
    metadata: { reportId: r.id, operation, date: r.effective_date, ...appliedAuditMeta(r, endedIds) } });
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
  // 승인 관리자 0명 = 관리자 승인 생략(작성 강사가 그 과목 관리자 · 원장 2026-11-03)일 때만 — 요청 창과 같은 계산으로 다시 본다.
  if (!parsed.data.managerIds.length && !(await managerStepSkippable(viewer.user.tenantId, parsed.data).catch(() => false)))
    return { error: "승인할 관리자를 선택해 주세요." };
  const db = createAdminClient();
  const { data, error } = await db.rpc("request_withdrawal_report_group", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_payload: parsed.data,
  });
  if (error) return { error: missingReportSchema(error) ? "퇴원보고서 기능을 준비 중입니다." : error.code === "23505" ? "이 학생의 진행 중인 보고서가 있습니다. 기존 요청을 먼저 확인해 주세요." : describeDbError(error, { fallback: "보고서 작성을 요청하지 못했습니다." }).message };
  const { data: report, error: readError } = await db.from("withdrawal_reports").select("*").eq("tenant_id", viewer.user.tenantId).eq("group_id", data).eq("group_leader", true).single();
  if (readError || !report) { refresh(); return { error: "요청은 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요." }; }
  await finish(report, "request");
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
  const db = createAdminClient();
  const { data, error } = await db.rpc("direct_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id,
    p_payload: { studentId: parsed.data.studentId, enrollmentIds: parsed.data.enrollmentIds, effectiveDate: parsed.data.effectiveDate,
      reason: parsed.data.reason, reasonDetail: reason.detail ?? "", memo: parsed.data.memo },
  });
  if (error) return { error: missingReportSchema(error) ? "바로 처리 기능을 준비 중입니다." : error.code === "23505" ? "이 학생의 진행 중인 보고서가 있습니다. 기존 보고서를 먼저 확인해 주세요." : describeDbError(error, { fallback: "바로 처리하지 못했습니다." }).message };
  const { data: report, error: readError } = await db.from("withdrawal_reports").select("*").eq("tenant_id", viewer.user.tenantId).eq("id", data as string).single();
  if (readError || !report) { refresh(); return { error: "처리는 저장됐지만 화면을 불러오지 못했습니다. 목록에서 확인해 주세요." }; }
  await finish(report as WithdrawalReport, "direct");
  return { ok: true, id: (report as WithdrawalReport).id };
}
export async function changeWithdrawalReport(id: string, action: ReportAction, revision: number, input?: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 보고서를 수정할 수 없습니다." };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["save", "submit", "approve", "reject", "cancel"].includes(action) || !Number.isSafeInteger(revision)) return { error: "요청 내용을 확인해 주세요." };
  const record = await getReport(id);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  if (action === "cancel" && record.report.requested_by !== viewer.user.id && !cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId))
    return { error: "작성 요청을 보낸 사람이나 원장만 취소할 수 있습니다." };
  const payload: { revision: number; body?: unknown; comment?: string } = { revision };
  if (action === "save" || action === "submit") {
    const parsed = bodySchema.safeParse(withoutBillingFields(input));
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "보고서 내용을 확인해 주세요." };
    if (action === "submit") { const error = submissionError(parsed.data); if (error) return { error }; }
    const existing = record.report.body.consultationIds ?? [];
    if (parsed.data.consultationIds?.some(id => !existing.includes(id) && !record.consultations.some(c => c.id === id))) return { error: "연결할 수 없는 상담기록이 포함되어 있습니다." };
    try { payload.body = { ...parsed.data, ...await loadReportBilling(record.report) }; }
    catch { return { error: "수납 정보를 확인하지 못했습니다. 잠시 후 다시 저장해 주세요." }; }
  }
  if (action === "reject") {
    if (typeof input !== "string" || !input.trim() || input.trim().length > 1000) return { error: "반려 사유를 1~1,000자로 작성해 주세요." };
    payload.comment = input.trim();
  }
  const { data, error } = await createAdminClient().rpc("transition_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_report: id, p_action: action, p_payload: payload,
  }).single();
  if (error) return { error: describeDbError(error, { fallback: "보고서 처리를 완료하지 못했습니다." }).message };
  await finish(data as WithdrawalReport, action);
  return { ok: true, id };
}
