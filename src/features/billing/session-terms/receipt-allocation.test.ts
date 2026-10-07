import { describe, expect, it } from "vitest";
import { connectReceiptTerm, distributeLinkedReceipt, distributeReceipt, effectiveAllocations, receiptAllocationSaveRows, receiptLines, receiptRemainder, sameBillAt, tuitionTotal, type AllocationTerm } from "./receipt-allocation";
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

/**
 * 원장 2026-10-07 *"금액이 바뀌지 않으면 그대로 두도록 해. 자꾸 확정이 풀리면 의문을 가질 수 밖에 없음."*
 * makeedu 동기화(매일 06·18시)가 금액은 그대로 두고 수납명만 바꾸면(수납명 속 강사·반·레벨 이름) 저장해 둔 배분이 통째로
 * '배분 재확인'이 됐다 — 실측: 9/19 79장 · 10/7 80장. 이름은 배분의 근거가 아니다(금액이 근거다).
 */
describe("수납명만 바뀐 줄은 배분을 그대로 둔다", () => {
  const before = { kind: "수업", description: "[EiE] 중2 정규 A (Charlie)", amount: 270000 };
  const renamed = { ...before, description: "[EiE] 중2 정규 A (Jennifer)" };
  const term = (over: Partial<AllocationTerm> = {}): AllocationTerm => ({ id: "t", confirmedSessions: 8, amount: 270000, lineIndex: 0, allocatedAmount: 270000, baseAmount: 270000, source: before, ...over });

  it("그 자리에서 이름만 바뀌면 유효 — 연결한 반 · 여러 반이 나누는 줄 · 연결 안 함 0원 · 자유 배분 전부", () => {
    expect(effectiveAllocations(receiptLines([renamed]), [term()]).get("t")).toBe(270000);
    const shared = [term({ id: "a", amount: 150000, allocatedAmount: 150000, baseAmount: 150000 }), term({ id: "b", amount: 120000, allocatedAmount: 120000, baseAmount: 120000 })];
    expect([...effectiveAllocations(receiptLines([renamed]), shared).values()]).toEqual([150000, 120000]);
    const zero = term({ id: "z", lineIndex: null, allocatedAmount: 0, source: [before] });
    expect(effectiveAllocations(receiptLines([renamed]), [term(), zero]).get("z")).toBe(0);
    const free = term({ id: "f", lineIndex: null, allocatedAmount: 200000, source: [before] });
    expect(effectiveAllocations(receiptLines([renamed]), [free]).get("f")).toBe(200000);
  });

  it("🔴 금액 · 종류 · 반 연결 · 합산 묶음이 달라지면 종전대로 재확인이다", () => {
    for (const changed of [{ ...renamed, amount: 280000 }, { ...renamed, kind: "교재" }, { ...renamed, classId: "c-other" }, { ...renamed, receiptGroupId: "g1" }]) {
      expect(effectiveAllocations(receiptLines([changed]), [term()]).has("t")).toBe(false);
    }
    // 이름이 프로그램 항목(수업료가 아닌 것)으로 바뀌면 지금 항목 기준으로 수업 항목이 아니다.
    expect(effectiveAllocations(receiptLines([{ ...before, description: "[강아] 강의하는 아이들" }]), [term()]).has("t")).toBe(false);
  });

  it("🔴 이름이 바뀐 게 아니라 **순서가 바뀐** 것은 다르다 — 저장 때 이름의 항목이 다른 번호에 그대로 있으면 이 번호는 남의 항목이다", () => {
    const math = { kind: "수업", description: "중2 수학 A반", amount: 240000 };
    const eng = { kind: "수업", description: "중2 영어 B반", amount: 240000 }; // 금액이 같은 다른 반
    const saved = term({ amount: 240000, allocatedAmount: 240000, baseAmount: 240000, source: math });
    // 저장 때는 [수학, 영어], 지금은 [영어, 수학] — 0번은 금액만 같은 영어 항목이다.
    const swapped = receiptLines([eng, math]);
    expect(sameBillAt(math, swapped[0], swapped)).toBe(false);
    expect(effectiveAllocations(swapped, [saved]).has("t")).toBe(false);
    // 제자리(1번)를 가리키면 당연히 같다 · 이름만 바뀐 것(저장 때 이름이 어디에도 없고 같은 금액의 다른 수업 항목도 없다)은 같다.
    expect(sameBillAt(math, swapped[1], swapped)).toBe(true);
    const book = { kind: "교재", description: "개념서", amount: 15000 };
    const renamedOnly = receiptLines([{ ...math, description: "중2 수학 A반(김그린)" }, book]);
    expect(sameBillAt(math, renamedOnly[0], renamedOnly)).toBe(true);
  });

  /**
   * 🔴 이름이 바뀐 **뒤에** 번호가 밀리면 스냅샷이 옛 이름이라 번호 옮기기(0267d)가 못 따라간다 — 옛 번호에 금액이 같은 남의 수업
   *    항목이 오면 그대로 유효로 남아, 그 항목이 환불될 때 엉뚱한 반이 0원이 되고 진짜 항목이 환불돼도 이 반은 그대로 받는다
   *    (적대 리뷰 2026-10-07). 가릴 근거가 이름뿐일 때는 재확인으로 둔다.
   */
  it("🔴 이름이 다른데 같은 금액의 수업 항목이 또 있으면 가릴 수 없다 → 재확인(이름이 바뀐 뒤 번호가 밀린 경우)", () => {
    const math = { kind: "수업", description: "중2 수학 A (Elsa)", amount: 300000 };
    const eng = { kind: "수업", description: "중2 영어 B", amount: 300000 };
    const saved = term({ amount: 300000, allocatedAmount: 300000, baseAmount: 300000, source: math });
    // t1: 그 자리에서 이름만 바뀜 — 같은 금액의 영어가 옆에 있어 이름 말고는 가릴 근거가 없다.
    const renamed = receiptLines([{ ...math, description: "중2 수학 A (Green)" }, eng]);
    expect(effectiveAllocations(renamed, [saved]).has("t")).toBe(false);
    // t2: 번호까지 밀려 0번이 영어 — 남의 항목에 붙으면 안 된다.
    const shifted = receiptLines([eng, { ...math, description: "중2 수학 A (Green)" }]);
    expect(effectiveAllocations(shifted, [saved]).has("t")).toBe(false);
    // 교재 한 줄이 앞에 끼어 밀린 경우: [특강 300k, 수학 300k]의 1번 → [교재, 특강 300k, 수학' 300k]의 1번(특강).
    const special = { kind: "수업", description: "[특강] 중3-2", amount: 300000 };
    const pushed = receiptLines([{ kind: "교재", description: "개념서", amount: 15000 }, special, { ...math, description: "중2 수학 A (Green)" }]);
    expect(effectiveAllocations(pushed, [{ ...saved, lineIndex: 1 }]).has("t")).toBe(false);
    // 진짜 항목(수학)이 전액 환불돼 급여 기준액이 0이 돼도 '같은 모양이 또 있다'는 판정은 남는다(환불 전 금액으로 본다 — 재리뷰).
    const refundedReal = receiptLines([eng, { ...math, description: "중2 수학 A (Green)", refunds: [{ status: "active", type: "full", amount: 300000 }] }]);
    expect(effectiveAllocations(refundedReal, [saved]).has("t")).toBe(false);
  });

  it("🔴 저장 때 이름의 항목이 다른 번호로 가면서 **금액도 바뀐** 경우 — 이 번호의 같은 금액 항목에 붙지 않는다", () => {
    const math = { kind: "수업", description: "중2 수학 A", amount: 300000 };
    const saved = term({ amount: 300000, allocatedAmount: 300000, baseAmount: 300000, source: math });
    const lines = receiptLines([{ kind: "수업", description: "중2 과학", amount: 300000 }, { ...math, amount: 320000 }]);
    expect(effectiveAllocations(lines, [saved]).has("t")).toBe(false);
  });

  it("전액 환불된 줄도 이름만 바뀐 것이면 0원으로 읽는다(환불이 저장한 양수 배분보다 우선)", () => {
    const refunded = { ...renamed, refunds: [{ status: "active", type: "full", amount: 270000 }] };
    expect(effectiveAllocations(receiptLines([refunded]), [term()]).get("t")).toBe(0);
    // 금액이 다른 항목이 그 번호에 온 것이면 환불이어도 이 반의 0원으로 읽지 않는다(다른 항목이다).
    expect(effectiveAllocations(receiptLines([{ ...refunded, amount: 300000 }]), [term()]).has("t")).toBe(false);
  });
});
