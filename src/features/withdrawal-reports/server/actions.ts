"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { pokeSlack } from "@/features/slack/server/poke";
import { describeDbError } from "@/lib/supabase/db-error";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { bodySchema, requestSchema, submissionError, missingReportSchema, REPORT_ACTION_LABEL, type ReportAction, type WithdrawalReport } from "../model";
import { reportViewer, getReport } from "./queries";

export type ReportResult = { ok: true; id: string } | { error: string };
function refresh() {
  for (const path of ["/withdrawal-reports", "/withdrawals", "/students", "/timetable", "/dashboard"]) revalidatePath(path, "layout");
}
async function finish(r: WithdrawalReport, action: keyof typeof REPORT_ACTION_LABEL) {
  await logAction({ action: "withdrawal_report_update", targetType: "student",
    targetLabel: r.snapshot.name, metadata: { reportId: r.id, operation: REPORT_ACTION_LABEL[action], date: r.effective_date } });
  if (action !== "save") pokeSlack(r.tenant_id);
  if (r.status === "completed") await recordMathWithdrawalToSheet({ tenantId: r.tenant_id, studentId: r.student_id, date: r.effective_date,
    enrollmentIds: r.snapshot.courses.filter(c => r.subjects.includes(c.subject)).map(c => c.id) });
  refresh();
}
export async function requestWithdrawalReport(input: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.request) return { error: "보고서 작성 요청 권한이 없습니다." };
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "입력 내용을 확인해 주세요." };
  if (viewer.scope && parsed.data.subjects.some(s => !viewer.scope!.includes(s))) return { error: "담당 과목의 보고서만 요청할 수 있습니다." };
  const { data, error } = await createAdminClient().rpc("transition_withdrawal_report", {
    p_tenant: viewer.user.tenantId, p_actor: viewer.user.id, p_report: null, p_action: "request", p_payload: parsed.data,
  }).single();
  if (error) return { error: missingReportSchema(error) ? "퇴원보고서 기능을 준비 중입니다." : error.code === "23505" ? "이 학생의 진행 중인 보고서가 있습니다. 기존 요청을 먼저 확인해 주세요." : describeDbError(error, { fallback: "보고서 작성을 요청하지 못했습니다." }).message };
  const report = data as WithdrawalReport;
  await finish(report, "request");
  return { ok: true, id: report.id };
}
export async function changeWithdrawalReport(id: string, action: ReportAction, revision: number, input?: unknown): Promise<ReportResult> {
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 보고서를 수정할 수 없습니다." };
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["save", "submit", "approve", "reject", "cancel"].includes(action) || !Number.isSafeInteger(revision)) return { error: "요청 내용을 확인해 주세요." };
  if (!(await getReport(id))) return { error: "보고서에 접근할 수 없습니다." };
  const payload: { revision: number; body?: unknown; comment?: string } = { revision };
  if (action === "save" || action === "submit") {
    const parsed = bodySchema.safeParse(input);
    if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "보고서 내용을 확인해 주세요." };
    if (action === "submit") { const error = submissionError(parsed.data); if (error) return { error }; }
    payload.body = parsed.data;
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
