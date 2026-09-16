export type ReceiptRefundState = "none" | "full" | "partial" | "mixed";
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

/** 전체환불은 할인 전 급여 기준도 0. 부분환불은 할인 귀속을 추정하지 않고 재확인한다. */
export function receiptRefundState(value: unknown): ReceiptRefundState {
  const row = record(value);
  if (Array.isArray(row.sourceItems) && row.sourceItems.length) {
    const states = row.sourceItems.map(receiptRefundState);
    if (states.includes("partial")) return "partial";
    if (states.every((s) => s === "full")) return "full";
    return states.every((s) => s === "none") ? "none" : "mixed";
  }
  const refunds = Array.isArray(row.refunds) ? row.refunds.map(record).filter((r) => r.status !== "cancelled") : [];
  if (refunds.some((r) => r.status === "active" && r.type === "full" && Number.isSafeInteger(r.amount) && Number(r.amount) >= 0)) return "full";
  return refunds.length ? "partial" : "none";
}

export function receiptSalaryAmount(value: unknown): number | null {
  const row = record(value), state = receiptRefundState(row);
  if (state === "partial") return null;
  if (state === "full") return 0;
  if (Array.isArray(row.sourceItems) && row.sourceItems.length) return row.sourceItems.reduce((sum, item) => sum + (receiptSalaryAmount(item) ?? 0), 0);
  return Math.round(Number(row.amount) || 0);
}
