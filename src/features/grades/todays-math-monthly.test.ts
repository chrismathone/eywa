import { describe, expect, it } from "vitest";
import { monthlyFromTodaysMath, planMonthlyFill, type TodaysMathMonthly } from "./todays-math-monthly";

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
