"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { createAdminClient } from "@/lib/supabase/admin";
import { canRequestRefund, cancelsAsDirector, missingReportSchema } from "../model";
import { REFUND_TAG_PREFIX } from "../refund-keys";
import { decisionBlocksProcessing, openClaims, type RefundCheck, type RefundDecision } from "../refund-decision";
import { getReport, reportViewer } from "./queries";
import { LINE_KEY, loadLaterInvoices, type LaterInvoice } from "./refund";
import { REFUND_GATE_NOT_READY, loadGroupRefundCheck, loadRefundDecisions, refundGateReady } from "./refund-check";
import { loadRefundLink } from "./refund-steps";
import { releaseWithdrawalGroup } from "./release";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 원장 결정(2026-11-09) **'환불하지 않음 — 늘어난 몫은 수납에서 따로 처리'** — 이 묶음 요청서가 환불을 마친 줄에 그 뒤 낸 돈이 늘었을 때.
 * - 첫 환불 기록(완료된 요청서)은 그대로 둔다 — 완료일자 비우기·삭제를 요구하지 않는다. 데스크는 늘어난 몫을 **일반 환불 요청서**로 처리한다.
 * - DB `decide_withdrawal_report_refund(p_separate)`가 같은 거래에서 그 줄을 '정함'으로 남기고 늘어난 금액·시각·결정자를 결정 행에 더한다
 *   (함정 ⅰ — 나중에 첫 요청서를 지우고 다시 승인해도 상한에서 뺀다 · attach 같은 식). 환불을 마친 줄·늘어난 줄이 아니면 DB도 거절한다.
 * - 권한: 원장급만(`canRequestRefund` — 환불 결정과 같은 판정) · 처리 전 보고서만 · 관문 SQL 적용 뒤만.
 * - 결정할 건이 남지 않고 승인·데스크 환불이 끝났으면 같은 확인 값으로 이어서 처리한다('환불 없음'과 같은 길 · 실패해도 결정은 남고 처리일 cron이 다시 처리).
 * - 알림: 그 요청서의 담당 데스크(재직)에게 기존 알림 종류로 한 번(새 알림 체계 없음) — 일반 요청서 설명에 표식을 쓰지 말라는 안내(함정 ⅱ)와 함께.
 * - 감사로그 `withdrawal_refund_separate`(줄 · 늘어난 금액 · 요청서 · 다음 단계).
 */
export async function separateWithdrawalRefundIncrease(reportId: string, key: string): Promise<{ ok: true; processed: boolean; undecided: number | null; amount: number } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || typeof key !== "string" || !LINE_KEY.test(key)) return { error: "요청 내용을 확인해 주세요." };
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 처리할 수 없습니다." };
  const record = await getReport(reportId);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  const report = record.report;
  if (!canRequestRefund(report, viewer.writable, cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId))) return { error: "환불 결정은 원장만 할 수 있습니다." };
  if (!report.group_id || !decisionBlocksProcessing(report.status)) return { error: "처리 전 퇴원보고서에서만 정할 수 있습니다." };
  const groupId = report.group_id;
  let later: LaterInvoice[], check: RefundCheck, decisions: Map<string, RefundDecision>;
  try {
    if (!(await refundGateReady())) return { error: REFUND_GATE_NOT_READY };
    [later, check, decisions] = await Promise.all([loadLaterInvoices(report), loadGroupRefundCheck(report.tenant_id, groupId), loadRefundDecisions(report.tenant_id, groupId)]);
  } catch (e) { console.error("[withdrawal-refund-separate] 환불 확인 실패", e); return { error: "환불할 수 있는 청구를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." }; }
  const claim = openClaims(later, decisions).find(o => o.key === key);
  if (!claim || claim.reason !== "increase" || !claim.separable || claim.before === null) return { error: "늘어난 몫을 따로 환불할 수 있는 건은 환불을 마친 요청서의 줄 중 그 뒤 낸 돈이 는 줄뿐입니다. 새로고침 후 다시 확인해 주세요." };
  const inv = later.find(i => i.lines.some(l => l.key === key))!;
  const line = inv.lines.find(l => l.key === key)!;
  const increase = claim.now - claim.before;
  const { data, error } = await createAdminClient().rpc("decide_withdrawal_report_refund", { p_tenant: report.tenant_id, p_actor: viewer.user.id, p_report: report.id, p_none: [key], p_check: check, p_separate: [key] });
  if (error) return { error: missingReportSchema(error) ? "환불 결정 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요." : error.message };
  const result = (data ?? {}) as { undecided?: number | null; ready?: boolean; separate?: number | string | null };
  const amount = result.separate == null ? increase : Number(result.separate);
  const released = result.ready ? await releaseWithdrawalGroup({ tenantId: report.tenant_id, groupId, actorId: viewer.user.id, check }) : null;
  const processed = !!released && released.released + released.blocked > 0;
  const undecided = typeof result.undecided === "number" ? result.undecided : null;
  const item = `${inv.period} ${line.description.trim()}`;
  await logAction({ action: "withdrawal_refund_separate", targetType: "student", targetLabel: report.snapshot.name,
    metadata: { reportId: report.id, documentId: claim.documentId, item, before: claim.before, now: claim.now, amount, effectiveDate: report.effective_date,
      next: processed ? "이어서 처리" : undecided === null ? "처리 확인 대기(확인 값 낡음 — 다음 확인 때 다시 판정)" : undecided > 0 ? `결정 안 된 줄 ${undecided}건` : "승인·데스크 환불이 끝나면 처리" } });
  // 담당 데스크(재직)에게 — 못 읽으면 알리지 않는다(결정은 남았다 · 보고서 상세에 늘 보인다).
  const link = await loadRefundLink(report.tenant_id, claim.documentId).catch((e: unknown) => { console.error("[withdrawal-refund-separate] 담당 데스크 확인 실패", e); return null; });
  if (link?.deskId && link.deskActive) {
    await notifyUsers([{ tenantId: report.tenant_id, recipientId: link.deskId, type: "refund_request_approved", actorId: viewer.user.id,
      title: `${report.snapshot.name} 늘어난 몫 ${won(amount)} — 따로 환불`,
      body: `${item}: 환불을 마친 뒤 낸 돈이 ${won(claim.before)}에서 ${won(claim.now)}로 늘었습니다. 원장이 늘어난 ${won(amount)}은 수납에서 따로 환불하기로 정했습니다 — 일반 환불 요청서로 처리해 주세요(앞선 요청서는 그대로 둡니다 · 설명에 '${REFUND_TAG_PREFIX}'을 쓰지 마세요).`,
      link: "/billing/refunds/new" }]);
  }
  revalidatePath("/withdrawal-reports", "layout");
  return { ok: true, processed, undecided, amount };
}
