import { receiptRefundState } from "./receipt-refund";
/** MakeEdu는 프로그램 별도 비용도 '수업'으로 보낸다. 급여 배분 대상 수강료만 구분한다. */
export function isTuitionReceipt(source: unknown): boolean {
  if (!source || typeof source !== "object") return false;
  const row = source as Record<string, unknown>;
  if (receiptRefundState(row) === "partial") return false;
  if (!["", "수업", "tuition", "수강료"].includes(String(row.kind ?? ""))) return false;
  const name = String(row.description ?? row.name ?? "").trim();
  if (/^(?:\[강아\]|(?:\[인재원\]\s*)?강의하는\s*아이들)/i.test(name)) return false;
  if (/^\[eie\]\s*(?:phonics\s*&\s*rookies|rookies\s*&\s*leaders)(?:\s|$)/i.test(name)) return false;
  return !Array.isArray(row.sourceItems) || !row.sourceItems.length || row.sourceItems.every(isTuitionReceipt);
}

export function needsReceiptAllocation(row: { allocatedAmount?: number | null; allocationStale?: boolean }): boolean {
  return row.allocationStale === true || row.allocatedAmount == null;
}
