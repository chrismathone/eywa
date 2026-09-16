import { expect, it } from "vitest";
import { receiptRefundState, receiptSalaryAmount } from "./receipt-refund";
import { effectiveAllocations, receiptLines } from "./receipt-allocation";
import { isTuitionReceipt } from "./tuition-receipt";
const bill = { kind: "수업", description: "중등E D", amount: 312000, discount: 10000, paid: 302000 };
const full = { ...bill, refunds: [{ status: "active", type: "full", amount: 302000 }] };
it("전체환불은 할인 전 312000원도 0원이 되며 원 청구액은 보존한다", () => {
  expect(receiptSalaryAmount(full)).toBe(0); expect(receiptRefundState(full)).toBe("full");
  const result = effectiveAllocations(receiptLines([full]), [{ id: "t", amount: 312000, confirmedSessions: 26, allocatedAmount: 312000, lineIndex: 0, baseAmount: 312000, source: bill }]);
  expect(result.get("t")).toBe(0); expect(full.amount).toBe(312000);
});
it("부분환불은 학부모 할인 귀속을 임의로 추정하지 않는다", () => {
  const partial = { ...bill, refunds: [{ status: "active", type: "partial", amount: 10000 }] };
  expect(receiptSalaryAmount(partial)).toBeNull(); expect(isTuitionReceipt(partial)).toBe(false);
});
it("합산 항목의 일부만 전액환불이면 나머지 원 청구액을 유지한다", () => {
  const merged = { ...full, amount: 624000, sourceItems: [full, bill] };
  expect(receiptRefundState(merged)).toBe("mixed"); expect(receiptSalaryAmount(merged)).toBe(312000);
});
it("환불 취소·할인만 변경한 경우 청구액을 줄이지 않는다", () => {
  expect(receiptSalaryAmount({ ...full, refunds: [{ status: "cancelled", type: "full", amount: 302000 }] })).toBe(312000);
  expect(receiptSalaryAmount({ ...bill, discount: 20000 })).toBe(312000);
});
