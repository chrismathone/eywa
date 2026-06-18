import { describe, expect, it } from "vitest";
import { examStats, rankByScore, type ExamScore } from "./calc";

const s = (score: number | null, maxScore: number | null = 100): ExamScore => ({ score, maxScore });

describe("examStats", () => {
  it("빈/전원 미응시는 전부 null", () => {
    expect(examStats([])).toEqual({ count: 0, avg: null, max: null, min: null, avgPct: null });
    expect(examStats([s(null), s(null)])).toEqual({
      count: 0,
      avg: null,
      max: null,
      min: null,
      avgPct: null,
    });
  });

  it("응시자만 집계 — count/avg/max/min/avgPct", () => {
    const r = examStats([s(80), s(60), s(null), s(100)]);
    expect(r.count).toBe(3);
    expect(r.avg).toBe(80); // (80+60+100)/3 = 80
    expect(r.max).toBe(100);
    expect(r.min).toBe(60);
    expect(r.avgPct).toBe(80); // 만점 100 기준
  });

  it("평균은 소수 1자리 반올림", () => {
    const r = examStats([s(80), s(81), s(81)]); // 242/3 = 80.666…
    expect(r.avg).toBe(80.7);
  });

  it("만점이 행마다 다르면 avgPct는 백분율 평균", () => {
    const r = examStats([
      { score: 45, maxScore: 50 }, // 90%
      { score: 70, maxScore: 100 }, // 70%
    ]);
    expect(r.avg).toBe(57.5); // 원점수 평균
    expect(r.avgPct).toBe(80); // (90+70)/2
  });

  it("만점 없으면 avgPct는 제외, 원점수 통계는 유지", () => {
    const r = examStats([{ score: 30, maxScore: null }, { score: 50, maxScore: null }]);
    expect(r.count).toBe(2);
    expect(r.avg).toBe(40);
    expect(r.avgPct).toBeNull();
  });
});

describe("rankByScore", () => {
  it("표준 경쟁 석차(1,2,2,4) + 입력 순서 보존", () => {
    const ranked = rankByScore([
      { studentId: "a", score: 90 },
      { studentId: "b", score: 80 },
      { studentId: "c", score: 80 },
      { studentId: "d", score: 70 },
    ]);
    const byId = Object.fromEntries(ranked.map((r) => [r.studentId, r.rank]));
    expect(byId).toEqual({ a: 1, b: 2, c: 2, d: 4 });
    expect(ranked.map((r) => r.studentId)).toEqual(["a", "b", "c", "d"]); // 순서 보존
  });

  it("미응시는 rank null", () => {
    const ranked = rankByScore([
      { studentId: "a", score: 90 },
      { studentId: "b", score: null },
    ]);
    expect(ranked.find((r) => r.studentId === "a")!.rank).toBe(1);
    expect(ranked.find((r) => r.studentId === "b")!.rank).toBeNull();
  });
});
