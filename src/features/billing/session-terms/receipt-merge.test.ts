import { describe, expect, it } from "vitest";
import { canMergeReceipt, enrollmentPeriodLabel, remapReceiptDraft } from "./receipt-merge";
import { effectiveAllocations, receiptLines } from "./receipt-allocation";

const a = { kind: "수업", description: "이동 전 반", amount: 40000, paid: 40000, unpaid: 0 };
const b = { kind: "수업", description: "이동 후 반", amount: 60000, paid: 50000, unpaid: 10000 };
const c = { kind: "수업", description: "영어", amount: 200000, paid: 200000, unpaid: 0 };
const merged = { kind: "수업", description: "이동 수강료", amount: 100000, paid: 90000, unpaid: 10000, receiptGroupId: "group", sourceItems: [a, b] };

describe("수납 수동 합산", () => {
  it("입력 중 배분은 그대로 두고 합산 및 뒤 항목의 번호를 이동한다", () => {
    const draft = { t1: { line: "0", amount: "30000" }, t2: { line: "1", amount: "70000" }, t3: { line: "2", amount: "200000" }, t4: { line: "", amount: "" } };
    const changed = remapReceiptDraft(receiptLines([a, b, c]), receiptLines([merged, c]), draft);
    expect(changed).toEqual({ t1: { line: "0", amount: "30000" }, t2: { line: "0", amount: "70000" }, t3: { line: "1", amount: "200000" }, t4: { line: "", amount: "" } });
    const undone = remapReceiptDraft(receiptLines([merged, c]), receiptLines([a, b, c]), changed);
    expect(undone.t1).toEqual({ line: "", amount: "30000" });
    expect(undone.t3.line).toBe("2");
  });
  it("환불·교재·납부 원본 없는 항목을 합산 후보에서 제외한다", () => {
    expect(canMergeReceipt(receiptLines([a])[0])).toBe(true);
    for (const line of [{ ...a, amount: -1 }, { ...a, kind: "교재" }, { kind: "수업", description: "수동", amount: 1 }]) expect(canMergeReceipt(receiptLines([line])[0])).toBe(false);
  });
  it("명칭과 총액이 같아도 다른 합산 그룹이면 완료 배분으로 취급하지 않는다", () => {
    const term = { id: "t", amount: null, confirmedSessions: null, lineIndex: 0, allocatedAmount: 100000, source: merged, baseAmount: null };
    expect(effectiveAllocations(receiptLines([merged]), [term]).get("t")).toBe(100000);
    expect(effectiveAllocations(receiptLines([{ ...merged, receiptGroupId: "other" }]), [term]).size).toBe(0);
    expect(effectiveAllocations(receiptLines([{ ...merged, classId: "different-class" }]), [term]).size).toBe(0);
  });
});

describe("청구월 등록 기간", () => {
  it("9월 7일 종료반과 9월 8일 시작반을 구분한다", () => {
    expect(enrollmentPeriodLabel("2026-09", [{ start_date: "2020-01-01", end_date: "2026-09-07" }], "2026-09-16")).toBe("9/1~9/7 · 종료");
    expect(enrollmentPeriodLabel("2026-09", [{ start_date: "2026-09-08", end_date: null }], "2026-09-16")).toBe("9/8~ · 수강 중");
    expect(enrollmentPeriodLabel("2026-09", [{ start_date: "2026-09-08", end_date: "2026-09-27" }], "2026-09-16")).toBe("9/8~9/27 · 종료 예정");
  });
});
