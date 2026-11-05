import { describe, expect, it } from "vitest";
import { pickMonthlyEvals, type MonthlyGradeRowWithClass } from "./english-monthly-pick";

const row = (over: Partial<MonthlyGradeRowWithClass>): MonthlyGradeRowWithClass => ({
  student_id: "a",
  class_id: "c1",
  school_year: 2026,
  exam_month: 10,
  taken_on: "2026-10-30",
  max_score: 400,
  area_scores: { writing: 90, speaking: 90, reading: 90, listening: 90 },
  ...over,
});

describe("pickMonthlyEvals", () => {
  it("반마다 가장 최근 달만 — 지난달 점수를 평균에 섞지 않는다", () => {
    const m = pickMonthlyEvals([
      row({ student_id: "a", exam_month: 9, taken_on: "2026-09-29", area_scores: { writing: 10, speaking: 10, reading: 10, listening: 10 } }),
      row({ student_id: "a" }),
      row({ student_id: "b", area_scores: { writing: 70, speaking: 70, reading: 70, listening: 70 } }),
    ]);
    const a = m.get("c1|a")!;
    expect(a.month).toBe("2026-10");
    expect(a.areaMax).toBe(100);
    expect(a.areas.writing).toEqual({ score: 90, average: 80 });
    expect(m.get("c1|b")!.areas.writing.score).toBe(70);
  });

  it("12월 시험을 1월 초에 적었어도 달은 지난해 12월", () => {
    const m = pickMonthlyEvals([row({ exam_month: 12, school_year: 2026, taken_on: "2027-01-03" })]);
    expect(m.get("c1|a")!.month).toBe("2026-12");
  });

  it("반이 없는 줄·점수 없는 학생은 싣지 않는다", () => {
    const m = pickMonthlyEvals([row({ class_id: null }), row({ student_id: "z", class_id: "c2", area_scores: null })]);
    expect(m.size).toBe(0);
  });
});
