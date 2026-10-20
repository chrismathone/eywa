import { describe, expect, it } from "vitest";
import { countTodaysMathSame, monthlyFromTodaysMath, planMonthlyFill, prefillFromTodaysMath, type TodaysMathMonthly } from "./todays-math-monthly";

const r = (score: number, maxScore: number | null = 100) => ({ score, maxScore, testDate: "2026-10-28", title: "10월 월말평가" });

describe("성적관리 월말평가 ← 오늘 수학", () => {
  const results: TodaysMathMonthly = { a: r(85), b: r(70), c: r(90), d: r(60, 88.33), e: r(77), f: r(50, null) };
  const rows = [
    { studentId: "a", applies: true }, { studentId: "a", applies: true }, // 두 반 학생 = 줄 둘, 칸 하나
    { studentId: "b", applies: true }, { studentId: "c", applies: true }, { studentId: "d", applies: true },
    { studentId: "e", applies: false }, { studentId: "f", applies: true }, { studentId: "g", applies: true },
  ];
  it("fills only empty, applicable cells whose max score matches; counts the other max separately", () => {
    const plan = planMonthlyFill(results, rows, { scores: { b: "64", c: " " }, noExam: { c: false, a: false } }, 100);
    expect(plan.fill).toEqual({ a: "85", c: "90" });
    expect(plan.maxMismatch).toBe(2);
    expect(plan.otherMax).toBe(88.33);
  });
  it("never fills a 시험없음 cell", () => {
    expect(planMonthlyFill(results, rows, { scores: {}, noExam: { a: true } }, 100).fill.a).toBeUndefined();
  });
  it("marks only while the value is still the Today Math score", () => {
    expect(monthlyFromTodaysMath(results, "a", "85", 100)).toBe(true);
    expect(monthlyFromTodaysMath(results, "a", "84", 100)).toBe(false);
    expect(monthlyFromTodaysMath(results, "a", "85", 50)).toBe(false);
    expect(monthlyFromTodaysMath(results, "a", "", 100)).toBe(false);
    expect(monthlyFromTodaysMath(null, "a", "85", 100)).toBe(false);
  });
});

describe("감사로그 출처 표시 — 오늘 수학과 같은 값 (2026-10-18)", () => {
  it("counts only same score at the same full mark; cleared cells and unknown students don't count", () => {
    const results: TodaysMathMonthly = { a: r(84), b: r(90), c: r(70, 88) };
    expect(countTodaysMathSame(results, [
      { studentId: "a", score: 84 }, { studentId: "b", score: 91 }, { studentId: "c", score: 70 },
      { studentId: "d", score: 60 }, { studentId: "a", score: null },
    ], 100)).toBe(1);
    expect(countTodaysMathSame(null, [{ studentId: "a", score: 84 }], 100)).toBe(0);
  });
});

describe("성적 입력 창 자동 채움 (2026-10-18)", () => {
  it("fills empty applicable cells at the same full mark; keeps typed, withdrawn, non-applying and noExam rows", () => {
    const results: TodaysMathMonthly = { a: r(84), b: r(90), c: r(70), d: r(60), e: r(80, 88), f: r(77) };
    const row = (studentId: string, over: Partial<{ applies: boolean; withdrawn: boolean; noExam: boolean }> = {}) =>
      ({ studentId, applies: true, withdrawn: false, noExam: false, ...over });
    const out = prefillFromTodaysMath(results,
      [row("a"), row("b"), row("c", { withdrawn: true }), row("d", { applies: false }), row("e"), row("f", { noExam: true })],
      { b: "70" }, 100);
    expect(out.scores).toEqual({ a: "84", b: "70" });
    expect(out.maxMismatch).toBe(1);
    expect(out.otherMax).toBe(88);
  });
  it("no results → scores untouched", () => {
    expect(prefillFromTodaysMath(null, [], { x: "1" }, 100)).toEqual({ fill: {}, maxMismatch: 0, otherMax: null, scores: { x: "1" } });
  });
});
