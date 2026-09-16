import { expect, it } from "vitest";
import { isTuitionReceipt, needsReceiptAllocation } from "./tuition-receipt";
import { receiptLines } from "./receipt-allocation";

it("수업으로 잘못 분류된 별도 비용을 제외하며 실제 EiE 월 수강료는 남긴다", () => {
  const raw = ["[강아] 강의하는아이들 (유형숙)", "초등M 개별 JJ1H 수", "초등M 초5 BS2C 월목", "[EiE] PHONICS&ROOKIES 40,000", "[EiE] ROOKIES&LEADERS 44,000", "[EIE] Junior Plus 1"].map((description) => ({ kind: "수업", description, amount: 30000 }));
  expect(receiptLines(raw).filter((l) => isTuitionReceipt(l.source)).map((l) => l.index)).toEqual([1, 2, 5]);
  expect(isTuitionReceipt({ kind: "교재", description: "Junior Plus 1" })).toBe(false);
  expect(isTuitionReceipt({ kind: "수업", sourceItems: [raw[0], raw[1]] })).toBe(false);
});
it("미배분 필터는 재확인을 포함하며 저장된 0원 배분도 완료로 취급한다", () => {
  expect(needsReceiptAllocation({ allocatedAmount: 0, allocationStale: false })).toBe(false);
  expect(needsReceiptAllocation({ allocatedAmount: 100, allocationStale: true })).toBe(true);
  expect(needsReceiptAllocation({ allocatedAmount: null })).toBe(true);
});
