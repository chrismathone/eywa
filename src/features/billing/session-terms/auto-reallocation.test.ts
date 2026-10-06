import { describe, expect, it } from "vitest";
import { invoiceAllocationStates } from "./allocation-state";
import { planAutoReallocation, type AutoRow, type AutoTerm } from "./auto-reallocation";

// 시수 확정 뒤 배분 자동 재확정(원장 2026-10-06 *"스마트하게 재확정 알아서"*) — 판단이 필요 없는 것만 대신 저장한다.
const math = { kind: "수업", description: "중2 수학 A반", amount: 240000 };
const eng = { kind: "수업", description: "중2 영어 B반", amount: 200000 };
const book = { kind: "교재", description: "개념서", amount: 15000 };

const term = (id: string, over: Partial<AutoTerm> = {}): AutoTerm => ({
  id, class_id: `c-${id}`, className: null, amount: 240000, confirmed_sessions: 8, confirmed_at: "2026-09-30T10:00:00+00:00",
  pricing_mode: "per_session", subject: "math", allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null, ...over,
});
/** 항목 하나를 혼자 받는 저장된 배분(기준액 = 저장 때 확정금액). */
const linked = (id: string, index: number, line: typeof math, base: number, over: Partial<AutoTerm> = {}) =>
  term(id, { allocation_line_index: index, allocation_amount: line.amount, allocation_source: line, allocation_base_amount: base, ...over });

/** 저장 함수(0269a)가 남길 모습 — 기준액 = 지금 확정금액 · 스냅샷 = 지금 청구 항목. */
function applySave(inv: { line_items: unknown[] }, terms: AutoTerm[], rows: AutoRow[]): AutoTerm[] {
  return terms.map((t) => {
    const r = rows.find((x) => x.termId === t.id);
    if (!r) return { ...t, allocation_line_index: null, allocation_amount: null, allocation_source: null, allocation_base_amount: null };
    return { ...t, allocation_line_index: r.lineIndex, allocation_amount: r.amount, allocation_source: r.lineIndex === null ? inv.line_items : inv.line_items[r.lineIndex], allocation_base_amount: t.amount };
  });
}

describe("배분 자동 재확정 — 대신 저장하는 것", () => {
  it("혼자 받는 항목의 반을 다시 확정 → 같은 배분 그대로 저장(기준액만 새 확정금액)", () => {
    const inv = { id: "i1", line_items: [math, book], status: "paid" };
    const terms = [linked("a", 0, math, 240000, { amount: 210000, confirmed_sessions: 7 })];
    expect(invoiceAllocationStates(inv, terms).get("a")?.allocationStale).toBe(true);
    const plan = planAutoReallocation(inv, terms);
    expect(plan).toEqual({ kind: "save", linked: [], rows: [{ termId: "a", lineIndex: 0, amount: 240000, baseAmount: 210000, confirmedAt: "2026-09-30T10:00:00+00:00" }] });
    const after = invoiceAllocationStates(inv, applySave(inv, terms, plan.kind === "save" ? plan.rows : []));
    expect(after.get("a")).toMatchObject({ allocationStale: false, allocatedAmount: 240000 });
  });

  it("배분 뒤 새로 확정한 반 — 반 이름이 맞는 빈 수업 항목이 하나뿐이면 그 항목 전액", () => {
    const inv = { id: "i1", line_items: [math, eng, book], status: "paid" };
    const terms = [linked("a", 0, math, 240000), term("b", { amount: 200000, className: "중2 영어 B반" })];
    const plan = planAutoReallocation(inv, terms);
    expect(plan.kind).toBe("save");
    if (plan.kind !== "save") return;
    expect(plan.linked).toEqual(["b"]);
    expect(plan.rows.find((r) => r.termId === "b")).toMatchObject({ lineIndex: 1, amount: 200000, baseAmount: 200000 });
    expect(plan.rows.find((r) => r.termId === "a")).toMatchObject({ lineIndex: 0, amount: 240000 });
  });

  it("비어 있는 항목이 여럿이면 반 이름이 맞는 항목이 하나뿐일 때만 연결", () => {
    const art = { kind: "수업", description: "중2 과학 C반", amount: 180000 };
    const inv = { id: "i1", line_items: [math, eng, art], status: "paid" };
    const terms = [linked("a", 0, math, 240000), term("b", { amount: 200000, className: "중2 영어 B반" })];
    const plan = planAutoReallocation(inv, terms);
    expect(plan.kind === "save" && plan.rows.find((r) => r.termId === "b")).toMatchObject({ lineIndex: 1, amount: 200000 });
    // 이름이 안 맞으면 고르지 않는다.
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000), term("b", { amount: 200000, className: "중2 국어" })])).toEqual({ kind: "skip", reason: "new-class" });
  });

  it("미확정인 채 배분해 둔 반(0267b)은 그대로 실어 보낸다 — 빠뜨리면 저장 함수가 그 배분을 지운다", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    const pre = term("p", { amount: null, confirmed_sessions: null, confirmed_at: null, allocation_line_index: 1, allocation_amount: 200000, allocation_source: eng });
    const plan = planAutoReallocation(inv, [linked("a", 0, math, 240000, { amount: 210000 }), pre]);
    expect(plan.kind === "save" && plan.rows.find((r) => r.termId === "p")).toEqual({ termId: "p", lineIndex: 1, amount: 200000, baseAmount: null, confirmedAt: null });
  });

  it("나누는 항목이 멀쩡하면 그대로 두고, 다른 줄의 혼자 받는 반만 다시 맞춘다", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    const terms = [
      term("a", { amount: 140000, allocation_line_index: 0, allocation_amount: 140000, allocation_source: math, allocation_base_amount: 140000 }),
      term("b", { amount: 100000, allocation_line_index: 0, allocation_amount: 100000, allocation_source: math, allocation_base_amount: 100000 }),
      linked("c", 1, eng, 200000, { amount: 175000 }),
    ];
    const plan = planAutoReallocation(inv, terms);
    expect(plan.kind === "save" && plan.rows.map((r) => [r.termId, r.lineIndex, r.amount])).toEqual([["a", 0, 140000], ["b", 0, 100000], ["c", 1, 200000]]);
  });

  it("연결 안 함 0원 행은 확인 표식과 함께 그대로", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    const zero = term("z", { amount: 0, confirmed_sessions: 0, allocation_amount: 0, allocation_source: [math], allocation_base_amount: 0, className: "끝난 반" });
    const plan = planAutoReallocation(inv, [linked("a", 0, math, 240000, { amount: 210000 }), zero]);
    expect(plan.kind === "save" && plan.rows.find((r) => r.termId === "z")).toMatchObject({ lineIndex: null, amount: 0, ackUnlinked: true });
  });
});

describe("배분 자동 재확정 — 사람 몫으로 남기는 것('배분 재확인' 그대로)", () => {
  it("🔴 여러 반이 나누는 항목에 재확인이 걸리면 손대지 않는다(나누는 법은 사람마다 다르다)", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    const terms = [
      term("a", { amount: 150000, allocation_line_index: 0, allocation_amount: 140000, allocation_source: math, allocation_base_amount: 140000 }),
      term("b", { amount: 100000, allocation_line_index: 0, allocation_amount: 100000, allocation_source: math, allocation_base_amount: 100000 }),
    ];
    expect(planAutoReallocation(inv, terms)).toEqual({ kind: "skip", reason: "shared" });
  });

  it("🔴 자유 배분(관리자 전용)은 손대지 않는다", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    const free = term("a", { amount: 210000, allocation_amount: 200000, allocation_source: [math], allocation_base_amount: 240000 });
    expect(planAutoReallocation(inv, [free])).toEqual({ kind: "skip", reason: "free" });
  });

  it("배분을 저장한 적 없는 청구서·이미 정상인 청구서·취소된 청구서는 건너뛴다", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    expect(planAutoReallocation(inv, [term("a")])).toEqual({ kind: "skip", reason: "none" });
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000)])).toEqual({ kind: "skip", reason: "valid" });
    expect(planAutoReallocation({ ...inv, status: "void" }, [linked("a", 0, math, 240000, { amount: 1 })])).toEqual({ kind: "skip", reason: "void" });
  });

  it("🔴 저장 뒤 청구 항목이 바뀐 줄(금액·이름·순서)은 손대지 않는다 — 다시 저장하면 스냅샷이 지금 항목으로 덮여 차이가 사라진다", () => {
    const changed = (line: typeof math) => planAutoReallocation({ id: "i1", line_items: [line, eng], status: "paid" }, [linked("a", 0, math, 240000, { amount: 210000 })]);
    expect(changed({ ...math, amount: 250000 })).toEqual({ kind: "skip", reason: "line-changed" });
    // 금액이 같아도 이름이 바뀌면(드라이런에서 실제로 걸린 모양) 사람이 본다.
    expect(changed({ ...math, description: "중2 수학 A반(9월 보충)" })).toEqual({ kind: "skip", reason: "line-changed" });
    // 순서가 바뀌어 같은 번호가 같은 금액의 다른 반 항목을 가리켜도 붙이지 않는다.
    const swapped = { id: "i2", line_items: [{ ...eng, amount: 240000 }, math], status: "paid" };
    expect(planAutoReallocation(swapped, [linked("a", 0, math, 240000, { amount: 210000 })])).toEqual({ kind: "skip", reason: "line-changed" });
    // 연결 안 함 0원 행도 저장 때 수업 항목 목록과 다르면 사람이 본다.
    const zero = term("z", { amount: 0, confirmed_sessions: 0, allocation_amount: 0, allocation_source: [math], allocation_base_amount: 0, className: "끝난 반" });
    expect(planAutoReallocation({ id: "i3", line_items: [math, eng], status: "paid" }, [linked("a", 0, math, 240000, { amount: 210000 }), zero]))
      .toEqual({ kind: "skip", reason: "line-changed" });
  });

  it("부분 환불이 있으면 사람이 본다", () => {
    const partial = { ...math, refunds: [{ status: "active", type: "partial", amount: 10000 }] };
    const inv = { id: "i1", line_items: [partial], status: "paid" };
    expect(planAutoReallocation(inv, [linked("a", 0, partial, 240000, { amount: 210000 })])).toEqual({ kind: "skip", reason: "refund" });
  });

  it("0시수로 다시 확정한 반에 금액이 가면 저장 함수가 거절한다 — 미리 멈춘다", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000, { amount: 0, confirmed_sessions: 0 })])).toEqual({ kind: "skip", reason: "zero" });
  });

  it("새 반의 자리가 정해지지 않으면(빈 항목 없음·둘 이상·다른 반 이름이 붙은 항목) 손대지 않는다", () => {
    const inv1 = { id: "i1", line_items: [math], status: "paid" };
    expect(planAutoReallocation(inv1, [linked("a", 0, math, 240000), term("b", { amount: 200000 })])).toEqual({ kind: "skip", reason: "new-class" });
    const inv2 = { id: "i2", line_items: [math, eng], status: "paid" };
    // 비어 있는 '영어 B반' 항목은 이름이 맞는 다른 반(영어 B반, 미확정) 몫이라 새 반에 주지 않는다.
    const waiting = term("w", { amount: null, confirmed_sessions: null, confirmed_at: null, className: "중2 영어 B반" });
    expect(planAutoReallocation(inv2, [linked("a", 0, math, 240000), term("b", { amount: 200000, className: "국어" }), waiting])).toEqual({ kind: "skip", reason: "new-class" });
    // 새 반이 둘인데 이름으로 가를 수 없으면 손대지 않는다.
    const inv3 = { id: "i3", line_items: [math, eng, { ...eng, description: "중2 과학" }], status: "paid" };
    expect(planAutoReallocation(inv3, [linked("a", 0, math, 240000), term("b", { amount: 200000 }), term("c", { amount: 200000 })])).toEqual({ kind: "skip", reason: "new-class" });
  });

  it("0시수로 새로 확정한 반은 금액이 있는 항목에 붙이지 않는다", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000), term("b", { amount: 0, confirmed_sessions: 0, className: "중2 영어 B반" })])).toEqual({ kind: "skip", reason: "zero" });
  });

  it("🔴 이름이 안 맞는 빈 항목은 하나뿐이어도 새 반에 주지 않는다 — 특강·다른 반 몫·사람이 0원으로 남긴 항목일 수 있다(적대 리뷰 H-1)", () => {
    const special = { kind: "수업", description: "9월 모의고사 특강", amount: 50000 };
    const visit = term("v", { amount: 30000, confirmed_sessions: 1, className: "보강 방문 영어" });
    expect(planAutoReallocation({ id: "i1", line_items: [math, special], status: "paid" }, [linked("a", 0, math, 240000), visit]))
      .toEqual({ kind: "skip", reason: "new-class" });
    // 사람이 '연결 안 함 0원'으로 남는 항목을 확인해 둔 청구서도 마찬가지
    const zero = term("z", { amount: 0, confirmed_sessions: 0, allocation_amount: 0, allocation_source: [math, special], allocation_base_amount: 0, className: "끝난 반" });
    expect(planAutoReallocation({ id: "i1", line_items: [math, special], status: "paid" }, [linked("a", 0, math, 240000), zero, visit]))
      .toEqual({ kind: "skip", reason: "new-class" });
    // 항목에 반 연결(classId)이 붙어 있으면 그 반 몫 — 회차 행이 아직 없는 반이라도 이름으로 가로채지 않는다
    const owned = { ...eng, classId: "c-x" };
    expect(planAutoReallocation({ id: "i2", line_items: [math, owned], status: "paid" }, [linked("a", 0, math, 240000), term("b", { amount: 200000, className: "중2 영어 B반" })]))
      .toEqual({ kind: "skip", reason: "new-class" });
    // 전액 환불된 반은 새로 확정돼도 빈 항목을 받지 않는다(다른 반의 재확인이 걸린 청구서에서 — 재리뷰 L)
    const refunded = { ...eng, refunds: [{ status: "active", type: "full", amount: 200000 }] };
    expect(planAutoReallocation({ id: "i3", line_items: [math, refunded], status: "paid" },
      [linked("a", 0, math, 240000, { amount: 210000 }), term("b", { amount: 200000, className: "중2 영어 B반", subject: "english" })])).toEqual({ kind: "skip", reason: "new-class" });
  });

  it("🔴 이름이 맞는 빈 항목이 다른 반(미확정 포함)과도 맞으면 고르지 않는다(적대 리뷰 M-2 — 접두 일치 '중2 수학' ⊂ '중2 수학 심화')", () => {
    const deep = { kind: "수업", description: "중2 수학 심화", amount: 200000 };
    const sci = { kind: "수업", description: "과학", amount: 150000 };
    // 다른 과목(학원 고유 과목)의 미확정 반이라 반 이동 가드엔 안 걸린다 — 이름 판정이 막아야 한다.
    const waiting = term("w", { amount: null, confirmed_sessions: null, confirmed_at: null, className: "중2 수학 심화", subject: "subject_1" });
    expect(planAutoReallocation({ id: "i1", line_items: [eng, deep, sci], status: "paid" },
      [linked("a", 0, eng, 200000), term("b", { amount: 200000, className: "중2 수학" }), waiting])).toEqual({ kind: "skip", reason: "new-class" });
  });

  it("🔴 확정을 풀어 둔 반이 있으면 다른 반 확정이 그 배분을 덮지 않는다(적대 리뷰 M-1)", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    // 해제는 확정금액·시각만 비우고 기준액은 남긴다(actions.ts unconfirm)
    const released = linked("u", 1, eng, 200000, { amount: null, confirmed_sessions: null, confirmed_at: null });
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000, { amount: 210000 }), released])).toEqual({ kind: "skip", reason: "released" });
  });

  it("🔴 '연결 안 함 0원' 반을 다른 시수로 다시 확정하면 0원 그대로 싣지 않는다 — 그 반 몫이 조용히 0원으로 굳는다(재리뷰 높음)", () => {
    const inv = { id: "i1", line_items: [math], status: "paid" };
    const zero = term("z", { amount: 150000, confirmed_sessions: 5, allocation_amount: 0, allocation_source: [math], allocation_base_amount: 0, className: "끝난 반" });
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000), zero])).toEqual({ kind: "skip", reason: "zero-changed" });
  });

  it("🔴 같은 과목에 확정도 배분도 안 된 반이 있으면(반 이동으로 나눌 수 있다) 새 반에 항목 전액을 주지 않는다(재리뷰 중간)", () => {
    const inv = { id: "i1", line_items: [eng, math], status: "paid" };
    const moved = term("y", { amount: null, confirmed_sessions: null, confirmed_at: null, className: "중2 수학 C반" });
    const base = [linked("e", 0, eng, 200000, { subject: "english" }), term("x", { className: "중2 수학 A반" })];
    expect(planAutoReallocation(inv, [...base, moved])).toEqual({ kind: "skip", reason: "new-class" });
    // 다른 과목의 미확정 반은 막지 않는다
    expect(planAutoReallocation(inv, [...base, { ...moved, subject: "science" }]).kind).toBe("save");
  });

  it("사람이 '연결 안 함 0원'으로 저장한 청구서의 금액 있는 빈 항목은 이름이 맞아도 새 반에 붙이지 않는다(그 항목은 '남는다'고 확인받았다)", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    const zero = term("z", { amount: 0, confirmed_sessions: 0, allocation_amount: 0, allocation_source: [math, eng], allocation_base_amount: 0, className: "끝난 반", subject: "science" });
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000), zero, term("b", { amount: 200000, className: "중2 영어 B반", subject: "english" })]))
      .toEqual({ kind: "skip", reason: "new-class" });
  });

  it("'연결 안 함 0원' 반에 이름이 맞는 수업 항목이 있으면 사람이 본다(서버 액션과 같은 판정)", () => {
    const inv = { id: "i1", line_items: [math, eng], status: "paid" };
    const zero = term("z", { amount: 0, confirmed_sessions: 0, allocation_amount: 0, allocation_source: [math, eng], allocation_base_amount: 0, className: "중2 영어 B반" });
    expect(planAutoReallocation(inv, [linked("a", 0, math, 240000, { amount: 210000 }), zero])).toEqual({ kind: "skip", reason: "zero-row" });
  });
});
