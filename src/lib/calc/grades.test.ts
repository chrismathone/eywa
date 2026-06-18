import { describe, expect, it } from "vitest";
import { pct, gradeStats, gradeSeries, type GradeInput } from "./grades";

const g = (score: number | null, maxScore: number | null, takenOn: string, subject = "math"): GradeInput => ({
  score,
  maxScore,
  takenOn,
  subject,
});

describe("pct", () => {
  it("점수/만점을 백분율 정수로", () => {
    expect(pct(80, 100)).toBe(80);
    expect(pct(45, 50)).toBe(90);
  });
  it("null/0 만점은 null", () => {
    expect(pct(null, 100)).toBeNull();
    expect(pct(50, 0)).toBeNull();
    expect(pct(50, null)).toBeNull();
  });
});

describe("gradeStats", () => {
  it("빈 입력은 전부 null", () => {
    expect(gradeStats([])).toEqual({
      count: 0,
      avgPct: null,
      recentAvgPct: null,
      delta: null,
      bestPct: null,
      worstPct: null,
    });
  });

  it("백분율 가능한 기록만 집계 + best/worst", () => {
    const s = gradeStats([
      g(80, 100, "2026-01-01"),
      g(60, 100, "2026-02-01"),
      g(null, 100, "2026-03-01"), // 제외
    ]);
    expect(s.count).toBe(2);
    expect(s.avgPct).toBe(70);
    expect(s.bestPct).toBe(80);
    expect(s.worstPct).toBe(60);
  });

  it("delta = 최근3 평균 − 직전3 평균 (정렬 무관)", () => {
    // 직전3: 50,50,50(avg50) / 최근3: 80,80,80(avg80) → delta +30
    const s = gradeStats([
      g(80, 100, "2026-06-01"),
      g(50, 100, "2026-01-01"),
      g(80, 100, "2026-05-01"),
      g(50, 100, "2026-02-01"),
      g(80, 100, "2026-04-01"),
      g(50, 100, "2026-03-01"),
    ]);
    expect(s.recentAvgPct).toBe(80);
    expect(s.delta).toBe(30);
  });

  it("직전3 없으면 delta null", () => {
    const s = gradeStats([g(80, 100, "2026-01-01"), g(90, 100, "2026-02-01")]);
    expect(s.delta).toBeNull();
  });
});

describe("gradeSeries", () => {
  it("오래된→최근 정렬 + 백분율만, label은 examName 우선", () => {
    const series = gradeSeries([
      { score: 90, maxScore: 100, takenOn: "2026-02-01", subject: "math", examName: "2월 모의" },
      { score: null, maxScore: 100, takenOn: "2026-03-01", subject: "math" },
      { score: 70, maxScore: 100, takenOn: "2026-01-01", subject: "math" },
    ]);
    expect(series.map((p) => p.pct)).toEqual([70, 90]);
    expect(series[1]!.label).toBe("2월 모의");
    expect(series[0]!.label).toBe("2026-01-01");
  });
});
