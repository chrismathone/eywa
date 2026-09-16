import { describe, expect, it } from "vitest";
import { distributeReceipt, effectiveAllocations, receiptLines, type AllocationTerm } from "./receipt-allocation";
import { computeSplitRows } from "./splits";
import { aggregateTeacherAllocations } from "./allocation";

const source = { kind: "수업", description: "수학 묶음", amount: 421875, discount: 10000, paid: 411875 };
const terms: AllocationTerm[] = [
  { id: "a", confirmedSessions: 6, amount: 187500, lineIndex: 0, allocatedAmount: 174569, baseAmount: 187500, source },
  { id: "b", confirmedSessions: 4.5, amount: 140625, lineIndex: 0, allocatedAmount: 130927, baseAmount: 140625, source },
  { id: "c", confirmedSessions: 4, amount: 125000, lineIndex: 0, allocatedAmount: 116379, baseAmount: 125000, source },
];

describe("할인 전 수납 청구액 배분", () => {
  it("차액을 확정금액 비율로 배분하고 원 단위 잔액까지 합계가 맞는다", () => {
    const values = distributeReceipt(source.amount, terms.map((t) => ({ id: t.id, amount: t.amount! })));
    expect(Object.values(values).reduce((a, b) => a + b, 0)).toBe(421875);
    expect(values).toEqual({ a: 174569, b: 130927, c: 116379 });
    expect(distributeReceipt(1, [{ id: "a", amount: 1 }, { id: "b", amount: 1 }])).toEqual({ a: 1, b: 0 });
  });
  it("0원 배분을 보존하며 금액 근거가 없는 비례 배분은 만들지 않는다", () => {
    expect(distributeReceipt(0, [{ id: "a", amount: 1 }])).toEqual({ a: 0 });
    expect(distributeReceipt(100, [{ id: "a", amount: 0 }])).toEqual({});
  });
  it("할인·납부 변경은 급여 배분을 바꾸지 않는다", () => {
    const lines = receiptLines([{ ...source, discount: 20000, paid: 0 }]);
    expect([...effectiveAllocations(lines, terms).values()]).toEqual([174569, 130927, 116379]);
  });
  it("청구액 변경·재확정·확정 해제·불일치 합계는 연결 그룹 전체를 무효로 한다", () => {
    expect(effectiveAllocations(receiptLines([{ ...source, amount: 400000 }]), terms).size).toBe(0);
    for (const change of [{ amount: 200000 }, { confirmedSessions: null }, { allocatedAmount: 174568 }, { allocatedAmount: -1 }]) {
      expect(effectiveAllocations(receiptLines([source]), [{ ...terms[0], ...change }, ...terms.slice(1)]).size).toBe(0);
    }
  });
  it("여러 수납 항목은 따로 검증하고 수동 조정한 배분도 합계가 맞으면 유지", () => {
    const separate = { ...source, description: "영어", amount: 270000 };
    const rows = [{ ...terms[0], allocatedAmount: 200000 }, { ...terms[1], allocatedAmount: 105496 }, terms[2], { ...terms[0], id: "d", source: separate, lineIndex: 1, allocatedAmount: 270000 }];
    expect(effectiveAllocations(receiptLines([source, separate]), rows).size).toBe(4);
  });
  it("급여 분배와 표시 집계가 같은 할인 전 금액을 쓰고 실제 시수에 비례한다", () => {
    const input = { invoiceId: "i", classId: "c", className: "수학", subject: "math", teacherId: "t", teacherName: "강사", confirmedSessions: 4.5, unitPrice: 31250, amount: 140625, actualConsumed: 3, allocatedAmount: 150000 };
    expect(computeSplitRows([input])[0]).toMatchObject({ confirmedAmount: 150000, actualAmount: 100000, confirmedSessions: 4.5 });
    expect(aggregateTeacherAllocations([input])[0]).toMatchObject({ confirmedAmount: 150000, actualAmount: 100000 });
    expect(computeSplitRows([{ ...input, pricingMode: "monthly", allocatedAmount: 270000, actualConsumed: 0 }])[0]).toMatchObject({ confirmedAmount: 270000, actualAmount: 270000 });
  });
});
