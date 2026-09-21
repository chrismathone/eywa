import { describe, expect, it } from "vitest";
import { connectReceiptTerm, distributeLinkedReceipt, distributeReceipt, effectiveAllocations, receiptAllocationSaveRows, receiptLines, receiptRemainder, tuitionTotal, type AllocationTerm } from "./receipt-allocation";
import { computeSplitRows } from "./splits";
import { aggregateTeacherAllocations } from "./allocation";

const source = { kind: "수업", description: "수학 묶음", amount: 421875, discount: 10000, paid: 411875 };
const terms: AllocationTerm[] = [
  { id: "a", confirmedSessions: 6, amount: 187500, lineIndex: 0, allocatedAmount: 174569, baseAmount: 187500, source },
  { id: "b", confirmedSessions: 4.5, amount: 140625, lineIndex: 0, allocatedAmount: 130927, baseAmount: 140625, source },
  { id: "c", confirmedSessions: 4, amount: 125000, lineIndex: 0, allocatedAmount: 116379, baseAmount: 125000, source },
];

describe("할인 전 수납 청구액 배분", () => {
  it("미확정 반 연결 시 다른 반의 입력액을 유지하고 선택한 항목의 잔액을 채운다", () => {
    const line = receiptLines([{ ...source, amount: 328125 }])[0];
    const draft = { a: { line: "0", amount: "140625" }, b: { line: "", amount: "" } };
    const next = connectReceiptTerm(draft, { id: "b", amount: null }, line);
    expect(next).toEqual({ a: draft.a, b: { line: "0", amount: "187500" } });
    expect(receiptRemainder(line, "b", next)).toBe(187500);
    expect(connectReceiptTerm(next, { id: "b", amount: null }, undefined).b).toEqual({ line: "", amount: "" });
    expect(receiptRemainder(line, "b", { ...draft, a: { line: "0", amount: "400000" } })).toBe(0);
  });
  it("확정 반의 수동 입력은 보존하고 미확정 반들에게만 잔액을 나눈다", () => {
    const line = receiptLines([{ ...source, amount: 328125 }])[0];
    expect(distributeLinkedReceipt(line, [{ id: "a", amount: 140625, confirmedSessions: 4.5 }, { id: "b", amount: null, confirmedSessions: null }, { id: "c", amount: null, confirmedSessions: null }], { a: { line: "0", amount: "140624" } })).toEqual({ b: 93751, c: 93750 });
  });
  it("미확정 배분도 재조회에 보존되며 급여 분배 행은 시수 확정 전까지 만들지 않는다", () => {
    const pending = { ...terms[0], confirmedSessions: null, amount: null, baseAmount: null };
    const allocations = effectiveAllocations(receiptLines([source]), [pending, ...terms.slice(1)]);
    expect(allocations.get(pending.id)).toBe(pending.allocatedAmount);
    expect(computeSplitRows([{ invoiceId: "i", classId: "c", subject: "math", teacherId: "t", teacherName: "강사", confirmedSessions: null, unitPrice: null, amount: null, allocatedAmount: pending.allocatedAmount, actualConsumed: 5 }])).toEqual([]);
    // 실제 확정 해제는 amount가 null이고 이전 baseAmount가 남아 있어 재확인을 요구한다.
    expect(effectiveAllocations(receiptLines([source]), [{ ...terms[0], confirmedSessions: null, amount: null }, ...terms.slice(1)]).size).toBe(0);
  });
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

describe("연결할 수납 항목이 없는 확정 반 = 0원 (원장 2026-09-17)", () => {
  const bill = [{ kind: "수업", description: "초5 BS2C", amount: 148750, discount: 0, paid: 148750 }];
  const zero: AllocationTerm = { id: "ls4b", confirmedSessions: 1, amount: 270000, lineIndex: null, allocatedAmount: 0, baseAmount: 270000, source: bill };

  it("저장 때의 청구 항목·확정금액이 그대로면 0원으로 인정한다(할인·납부 갱신은 무관)", () => {
    expect(effectiveAllocations(receiptLines(bill), [zero]).get("ls4b")).toBe(0);
    const paidLater = [{ ...bill[0], paid: 0, discount: 5000 }];
    expect(effectiveAllocations(receiptLines(paidLater), [zero]).get("ls4b")).toBe(0);
  });

  it("청구 항목이 바뀌거나(새 수납) 확정금액이 바뀌거나 미확정이면 인정하지 않는다 — 재확인 대상", () => {
    const added = [...bill, { kind: "수업", description: "LS4b", amount: 270000 }];
    expect(effectiveAllocations(receiptLines(added), [zero]).has("ls4b")).toBe(false);
    // 교재 같은 수업 아닌 항목이 붙거나 순서가 바뀌는 것만으로는 재확인으로 떨어지지 않는다.
    const withBook = [{ kind: "교재", description: "교재비", amount: 15000 }, ...bill];
    expect(effectiveAllocations(receiptLines(withBook), [zero]).get("ls4b")).toBe(0);
    expect(effectiveAllocations(receiptLines(bill), [{ ...zero, amount: 300000 }]).has("ls4b")).toBe(false);
    expect(effectiveAllocations(receiptLines(bill), [{ ...zero, confirmedSessions: null, amount: null }]).has("ls4b")).toBe(false);
    // 배분을 지운 행(금액 null)은 이 갈래가 아니다.
    expect(effectiveAllocations(receiptLines(bill), [{ ...zero, allocatedAmount: null }]).has("ls4b")).toBe(false);
    // 연결 행 없이 양수만 있는 청구서는 이제 **자유 배분**(0279a, 원장 2026-09-21)이다 — 항목·확정금액이 그대로이고
    // 합계가 수업 청구액 이하면 유효(종전엔 이 모양을 0269a가 저장하지 못해 무효로 봤다).
    expect(effectiveAllocations(receiptLines(bill), [{ ...zero, allocatedAmount: 5 }]).get("ls4b")).toBe(5);
  });

  it("저장 행: 하나라도 연결했을 때만 연결 안 한 확정 반을 0원으로 보낸다 · 미확정은 보내지 않는다", () => {
    const terms = [
      { id: "a", amount: 148750, confirmedSessions: 7, confirmedAt: "t1" },
      { id: "b", amount: 270000, confirmedSessions: 1, confirmedAt: "t2" },
      { id: "c", amount: null, confirmedSessions: null, confirmedAt: null },
    ];
    expect(receiptAllocationSaveRows(terms, { a: { line: "0", amount: "148750" }, b: { line: "", amount: "270000" }, c: { line: "", amount: "" } })).toEqual([
      { termId: "a", lineIndex: 0, amount: 148750, baseAmount: 148750, confirmedAt: "t1" },
      { termId: "b", lineIndex: null, amount: 0, baseAmount: 270000, confirmedAt: "t2" },
    ]);
    // 아무것도 연결하지 않으면 종전대로 빈 저장(= 기존 배분 해제).
    expect(receiptAllocationSaveRows(terms, { a: { line: "", amount: "" }, b: { line: "", amount: "" }, c: { line: "", amount: "" } })).toEqual([]);
  });
});

describe("자유 배분(0279a) — 수납 항목에 하나도 연결하지 않고 금액만", () => {
  const tuition = { kind: "수업", description: "수학 수강료", amount: 169375 };
  const book = { kind: "교재", description: "교재", amount: 12000 };
  const lines = receiptLines([tuition, book]);
  const snapshot = [tuition, book];
  const free = (id: string, amount: number, base: number, over: Partial<Parameters<typeof effectiveAllocations>[1][number]> = {}) => ({
    id, amount: base, confirmedSessions: 3, lineIndex: null, allocatedAmount: amount, source: snapshot, baseAmount: base, ...over,
  });
  it("합계가 수업 청구액 이하이고 항목·확정금액이 그대로면 유효 — 교재는 상한에 안 들어간다", () => {
    const out = effectiveAllocations(lines, [free("a", 63750, 63750), free("b", 105625, 95625, { baseAmount: 95625, amount: 95625 })]);
    expect(out.get("a")).toBe(63750);
    expect(out.get("b")).toBe(105625);
    expect(tuitionTotal(lines)).toBe(169375);
  });
  it("덜 준 것은 유효(남은 금액은 분배 안 됨) · 넘으면 전부 무효", () => {
    expect(effectiveAllocations(lines, [free("a", 60000, 63750)]).get("a")).toBe(60000);
    const over = effectiveAllocations(lines, [free("a", 100000, 63750), free("b", 100000, 95625)]);
    expect(over.has("a")).toBe(false);
    expect(over.has("b")).toBe(false);
  });
  it("청구 항목이 바뀌거나 확정금액이 바뀌면 무효(배분 재확인)", () => {
    expect(effectiveAllocations(receiptLines([{ ...tuition, amount: 170000 }, book]), [free("a", 60000, 63750)]).has("a")).toBe(false);
    expect(effectiveAllocations(lines, [free("a", 60000, 63750, { amount: 70000 })]).has("a")).toBe(false);
  });
  it("연결 행이 하나라도 있는 청구서는 자유 배분으로 읽지 않는다(항목별 배분 그대로)", () => {
    const linked = { id: "l", amount: 169375, confirmedSessions: 3, lineIndex: 0, allocatedAmount: 169375, source: tuition, baseAmount: 169375 };
    const out = effectiveAllocations(lines, [linked, free("a", 5000, 63750)]);
    expect(out.get("l")).toBe(169375);
    expect(out.has("a")).toBe(false);
  });
});
