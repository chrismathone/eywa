// 수강료(invoice) 요약 — 순수 함수(서버 전용 아님 → Vitest 가능, #Q2). queries.ts가 re-export한다.

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
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 청구서 배열 → 요약 KPI (순수, 네트워크 0).
 * 페이지가 월 전체를 한 번만 fetch한 뒤 이 함수로 요약을 도출해 이중 fetch를 없앤다.
 * paymentRate는 청구액 0이면 0(0-나눗셈 방어).
 */
export function summarizeInvoices(rows: InvoiceSummaryInput[], period?: string): BillingSummary {
  const totalBilled = rows.reduce((s, r) => s + r.amountTotal, 0);
  const totalCollected = rows.reduce((s, r) => s + r.amountPaid, 0);
  return {
    period: period ?? currentPeriod(),
    totalCount: rows.length,
    paidCount: rows.filter((r) => r.status === "paid").length,
    partialCount: rows.filter((r) => r.status === "partial").length,
    unpaidCount: rows.filter((r) => r.status === "unpaid").length,
    totalBilled,
    totalCollected,
    totalDiscount: rows.reduce((s, r) => s + r.amountDiscount, 0),
    outstanding: totalBilled - totalCollected,
    paymentRate: totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 0,
  };
}
