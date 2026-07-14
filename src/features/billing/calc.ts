// 수강료(invoice) 요약 — 순수 함수(서버 전용 아님 → Vitest 가능, #Q2). queries.ts가 re-export한다.
import { kstMonth } from "@/lib/date-kst";

export type BillingSummary = {
  period: string;
  totalCount: number;
  paidCount: number;
  partialCount: number;
  unpaidCount: number;
  totalBilled: number;
  totalCollected: number;
  totalDiscount: number;
  outstanding: number;
  paymentRate: number;
};

/** summarizeInvoices 입력 — InvoiceRow의 구조적 부분집합(집계에 쓰는 필드만). */
export type InvoiceSummaryInput = {
  amountTotal: number;
  amountPaid: number;
  amountDiscount: number;
  status: string;
};

export function currentPeriod(): string {
  return kstMonth(); // KST 당월(YYYY-MM) — 서버 UTC에서 new Date 계산 시 KST 자정~오전 오차 방지
}

/** 미수 잔액에서 제외하는 상태 — refunded/void(무효) + paid(완납 판정은 status가 진실 — 적립금 잔차 무시). */
const NO_OUTSTANDING_STATUSES = new Set(["refunded", "void", "paid"]);

/**
 * 행 레벨 미수 잔액 = max(0, 청구−할인−수납). refunded/void/paid는 0.
 * 수납 지표 단일 공식 — 대시보드·엑셀·학생 상세·RPC(0101a)가 전부 이 공식을 따른다. 재구현 금지.
 */
export function invoiceOutstanding(r: InvoiceSummaryInput): number {
  if (NO_OUTSTANDING_STATUSES.has(r.status)) return 0;
  return Math.max(0, r.amountTotal - r.amountDiscount - r.amountPaid);
}

/** 수납률(%) = 수납 / 실청구(청구−할인), 100% 상한. 실청구 ≤ 0이면 0(0-나눗셈 방어). */
export function paymentRateOf(collected: number, netBilled: number): number {
  return netBilled > 0 ? Math.min((collected / netBilled) * 100, 100) : 0;
}

/**
 * 청구서 배열 → 요약 KPI (순수, 네트워크 0).
 * 페이지가 월 전체를 한 번만 fetch한 뒤 이 함수로 요약을 도출해 이중 fetch를 없앤다.
 *
 * ⚠️ 미수금·수납률은 **할인을 차감한 실청구(net = 청구−할인)** 기준이다. 학생이 할인받은 만큼
 * 덜 내는 게 정상이므로 `outstanding = 청구−할인−수납`(음수는 0으로 바닥)이어야 한다. 예전엔
 * `청구−수납`이라 할인액이 통째로 미수금으로 잡혀(수납률도 100% 미달) 완납 학생이 미수로 보였다.
 * refunded/void는 미수 집계에서 제외. **paid(완납 판정)도 제외** — makeedu 적립금 납부분은 실납(paid)에
 * 안 잡혀 완납 행에도 양수 잔차가 남는다(실측 7건/351,250원 유령 미수). 완납 여부는 makeedu 미납 합
 * 기준(status)이 진실. paymentRate는 net 0이면 0(0-나눗셈 방어), 100% 상한.
 */
export function summarizeInvoices(rows: InvoiceSummaryInput[], period?: string): BillingSummary {
  const totalBilled = rows.reduce((s, r) => s + r.amountTotal, 0);
  const totalCollected = rows.reduce((s, r) => s + r.amountPaid, 0);
  const totalDiscount = rows.reduce((s, r) => s + r.amountDiscount, 0);
  const netBilled = totalBilled - totalDiscount;
  const outstanding = rows.reduce((s, r) => s + invoiceOutstanding(r), 0);
  return {
    period: period ?? currentPeriod(),
    totalCount: rows.length,
    paidCount: rows.filter((r) => r.status === "paid").length,
    partialCount: rows.filter((r) => r.status === "partial").length,
    unpaidCount: rows.filter((r) => r.status === "unpaid").length,
    totalBilled,
    totalCollected,
    totalDiscount,
    outstanding,
    paymentRate: paymentRateOf(totalCollected, netBilled),
  };
}
