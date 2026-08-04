import { describe, expect, it } from "vitest";
import {
  averageTotals,
  CHECKLIST_AREAS,
  computeTotals,
  gradeOf,
  MAX_TOTAL,
  normalizeScore,
  TOTAL_ITEMS,
} from "./checklist";

describe("checklist 구조", () => {
  it("6영역 × 5문항 = 30문항, 만점 120", () => {
    expect(CHECKLIST_AREAS).toHaveLength(6);
    for (const a of CHECKLIST_AREAS) expect(a.items).toHaveLength(5);
    expect(TOTAL_ITEMS).toBe(30);
    expect(MAX_TOTAL).toBe(120);
  });
});

describe("computeTotals", () => {
  it("시트 실측 재현 — 전부 3점이면 90/120 = 75.0 = B", () => {
    const t = computeTotals({ scores: Array(30).fill(3) });
    expect(t.total).toBe(90);
    expect(t.percent).toBe(75);
    expect(t.grade).toBe("B");
    expect(t.complete).toBe(true);
    expect(t.areaSubtotals).toEqual([15, 15, 15, 15, 15, 15]);
  });

  it("시트 등급 수식 그대로 — S/A+/A/B+/B/C/재참관", () => {
    expect(gradeOf(96)).toBe("S");
    expect(gradeOf(95)).toBe("S");
    expect(gradeOf(90)).toBe("A+");
    expect(gradeOf(85.2)).toBe("A"); // 시트 캡처 실측값
    expect(gradeOf(84.9)).toBe("B+");
    expect(gradeOf(75)).toBe("B");
    expect(gradeOf(70)).toBe("C");
    expect(gradeOf(69.9)).toBe("재참관");
  });

  it("미입력(0·범위 밖)은 0점 취급 + complete=false", () => {
    const scores = Array(30).fill(4);
    scores[0] = 0;
    scores[1] = 7 as number; // 범위 밖 → 미입력
    const t = computeTotals({ scores });
    expect(t.answered).toBe(28);
    expect(t.complete).toBe(false);
    expect(t.total).toBe(28 * 4);
  });

  it("빈 장도 안전", () => {
    const t = computeTotals(null);
    expect(t.total).toBe(0);
    expect(t.grade).toBe("재참관");
  });
});

describe("normalizeScore", () => {
  it("1~4 정수만 인정", () => {
    expect(normalizeScore(3)).toBe(3);
    expect(normalizeScore("4")).toBe(4);
    expect(normalizeScore(5)).toBe(0);
    expect(normalizeScore(0)).toBe(0);
    expect(normalizeScore(null)).toBe(0);
  });
});

describe("averageTotals", () => {
  it("제출된 장만 평균 — 4점 장과 2점 장의 평균은 문항당 3점", () => {
    const avg = averageTotals([
      { scores: Array(30).fill(4) },
      { scores: Array(30).fill(2) },
      { scores: [] }, // 미제출은 제외
    ]);
    expect(avg).not.toBeNull();
    expect(avg!.total).toBe(90);
    expect(avg!.percent).toBe(75);
  });

  it("아무도 제출 안 했으면 null", () => {
    expect(averageTotals([{ scores: [] }])).toBeNull();
  });
});
