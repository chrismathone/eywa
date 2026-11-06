import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { describeDbError } from "@/lib/supabase/db-error";
import { kstToday } from "@/lib/date-kst";
import type { WithdrawalReport } from "../model";
import { loadGroupRefundCheck } from "./refund-check";

/**
 * 바로 처리의 처리(원장 2026-11-06 · s2_0032) — DB `direct_withdrawal_report`가 부르는 apply는 환불 확인 값이 없어 미룬다(처리 예약으로 남는다).
 * 처리일이 오늘 이전이면 **이 요청 안에서** 묶음 환불 확인 값을 계산해 같은 처리 함수(apply · 행위자 = 처리한 사람)로 처리한다 —
 * 원장이 결정하지 않은 환불 가능 줄이 있으면 DB가 처리하지 않고 '환불 결정 대기'로 둔다(원장 알림·할 일). 확인 값을 못 만들면 처리 예약으로 두고
 * 처리일 cron(00:05)이 다시 계산한다. 그대로 둔 까닭은 감사로그에 남긴다(`refundWait`).
 * 부르는 곳: 관리자 바로 처리(`processWithdrawalDirectly`) · 관리 도구 장부 정리(`bulkWithdrawStudents`). 서버 액션 파일 밖에 둔다(내보낸 서버 액션은 화면이 아무 값으로나 부를 수 있다).
 */
export async function applyDirectNow(report: WithdrawalReport, actorId: string): Promise<{ report: WithdrawalReport; extra: Record<string, unknown> }> {
  if (report.status !== "scheduled" || !report.group_id || report.effective_date > kstToday()) return { report, extra: {} };
  let refundCheck;
  try { refundCheck = await loadGroupRefundCheck(report.tenant_id, report.group_id); }
  catch (e) { console.error("[withdrawal-direct] 환불 확인 실패", e); return { report, extra: { refundWait: "환불 확인 실패 — 처리일 확인(00:05) 때 다시 처리" } }; }
  const { data, error } = await createAdminClient().rpc("transition_withdrawal_report", {
    p_tenant: report.tenant_id, p_actor: actorId, p_report: report.id, p_action: "apply", p_payload: { refundCheck },
  }).single();
  if (error) { console.error("[withdrawal-direct] 처리 실패", error.message); return { report, extra: { refundWait: `처리 실패 — ${describeDbError(error, { fallback: "처리하지 못했습니다." }).message}` } }; }
  const applied = data as WithdrawalReport;
  return { report: applied, extra: applied.status === "scheduled" ? { refundWait: "원장 환불 결정 대기" } : {} };
}
