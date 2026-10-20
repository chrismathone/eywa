import { describe, expect, it } from "vitest";
import { averageProgress } from "./teacher-average";

describe("averageProgress", () => {
  it("학생 평균 · 기록 없는 학생은 빼고 센다", () => {
    expect(averageProgress([
      { window: { done: 7, total: 16 } },
      { window: { done: 16, total: 16 } },
      { window: { done: null, total: 16 } },
      { window: null },
    ])).toEqual({ pct: 72, counted: 2 });
  });
  it("셀 학생이 없으면 null", () => {
    expect(averageProgress([{ window: null }])).toEqual({ pct: null, counted: 0 });
  });
});
