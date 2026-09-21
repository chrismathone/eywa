// 청구서 한 장의 회차 행마다 **유효 배분액·재확인 여부·환불 상태** — 순수 함수(Vitest).
//
// 회차 확정 면(`getSessionTermsView`)이 행마다 인라인으로 하던 판정을 옮겨 왔다. 🔑 금액 이월(2026-09-21)은
// 보내는 달(이 판정으로 '이월 유효')과 받는 달(지난 달 청구서를 같은 판정으로 다시 본다)이 **한 함수**를 지나야 한다 —
// 한쪽만 다르게 보면 보내는 쪽은 안 빼고 받는 쪽만 더해 같은 돈이 두 번 분배된다.
import type { LineItemLike } from "./class-amount";
import { effectiveAllocations, receiptLines } from "./receipt-allocation";
import { receiptOriginalItems, receiptRefundState, type ReceiptRefundState } from "./receipt-refund";
import { receiptMatchesClass } from "./receipt-suggestion";

export type AllocationInvoice = { id: string; line_items: unknown; status: string | null };
export type AllocationTermRow = {
  id: string;
  class_id: string | null;
  /** 환불 판정용 반 이름(청구 항목 매칭) — 모르면 null. */
  className: string | null;
  amount: number | string | null;
  confirmed_sessions: number | string | null;
  allocation_line_index: number | null;
  allocation_amount: number | string | null;
  allocation_source: unknown;
  allocation_base_amount: number | string | null;
};
export type TermAllocationState = {
  /** 유효 배분액 — 전액 환불이면 0, 배분 없음·무효면 null. */
  allocatedAmount: number | null;
  /** 배분을 저장했는데 지금 청구 항목과 안 맞는다(또는 부분 환불) — '배분 재확인 필요'. */
  allocationStale: boolean;
  refundState: ReceiptRefundState;
  fullyRefunded: boolean;
  /**
   * 배분액이 **환불로 만든 0**인가 — 반 이름으로 찾는 `fullyRefunded` 말고도, 여러 반이 나누는 한 줄이 전액 환불되면
   * `effectiveAllocations`가 그 줄의 반들을 0으로 만든다(반 이름 매칭으론 안 잡힌다). 금액 이월은 이런 줄에 싣지 않는다.
   */
  refundedAllocation: boolean;
};

export const invoiceLineItems = (inv: { line_items: unknown }) => (Array.isArray(inv.line_items) ? inv.line_items : []) as LineItemLike[];

/** 청구서 한 장에서 이 반 몫의 환불 상태 — 회차 행·가상 행이 같은 판정을 쓴다. */
export function refundBits(inv: { status: string | null }, lineItems: LineItemLike[], classId: string | null, className: string | null) {
  const matching = lineItems.flatMap(receiptOriginalItems).filter((line) => receiptMatchesClass(line, { classId, className }));
  const states = matching.map(receiptRefundState);
  const fullyRefunded = inv.status === "refunded" || (states.length > 0 && states.every((s) => s === "full"));
  const refundReview = lineItems.some((line) => receiptRefundState(line) === "partial" || (receiptRefundState(line) === "mixed" && "receiptGroupId" in line));
  const refundState: ReceiptRefundState = fullyRefunded ? "full" : refundReview ? "partial" : states.some((s) => s !== "none") ? "mixed" : "none";
  return { fullyRefunded, refundState };
}

const num = (v: number | string | null) => (v === null ? null : Number(v));

/** `invTerms` = 그 청구서의 회차 행 **전부**(같은 수납 항목을 나누는 다른 반까지 봐야 유효성을 안다). */
export function invoiceAllocationStates(inv: AllocationInvoice, invTerms: readonly AllocationTermRow[]): Map<string, TermAllocationState> {
  const allocated = effectiveAllocations(receiptLines(inv.line_items), invTerms.map((t) => ({
    id: t.id, amount: num(t.amount), confirmedSessions: num(t.confirmed_sessions),
    lineIndex: t.allocation_line_index ?? null, allocatedAmount: t.allocation_amount == null ? null : Number(t.allocation_amount),
    source: t.allocation_source, baseAmount: t.allocation_base_amount == null ? null : Number(t.allocation_base_amount),
  })));
  // 연결 없이 0원으로 저장한 반(0269a — 항목 null · 금액 0)도 배분을 저장한 청구서다.
  const hasAllocations = invTerms.some((t) => t.allocation_line_index != null || t.allocation_amount != null);
  const lineItems = invoiceLineItems(inv);
  const lines = receiptLines(inv.line_items);
  const out = new Map<string, TermAllocationState>();
  for (const t of invTerms) {
    const { fullyRefunded, refundState } = refundBits(inv, lineItems, t.class_id, t.className);
    const saved = t.allocation_line_index != null || t.allocation_amount != null || (hasAllocations && t.confirmed_sessions !== null);
    const line = t.allocation_line_index == null ? undefined : lines.find((l) => l.index === t.allocation_line_index);
    const lineRefunded = !!line && receiptRefundState(line.source) === "full" && allocated.get(t.id) === 0;
    out.set(t.id, {
      allocatedAmount: fullyRefunded ? 0 : allocated.get(t.id) ?? null,
      allocationStale: !fullyRefunded && (refundState === "partial" || (saved && !allocated.has(t.id))),
      refundState,
      fullyRefunded,
      refundedAllocation: fullyRefunded || lineRefunded,
    });
  }
  return out;
}
