import { describe, expect, it } from "vitest";
import { averagePoints, reviewPoints } from "./score";

const s = (accuracy: number | null, order: number | null, reasoning: number | null, terms: number | null, delivery: number | null) =>
  ({ accuracy: { score: accuracy }, order: { score: order }, reasoning: { score: reasoning }, terms: { score: terms }, delivery: { score: delivery } });

describe("AI 참고 평점 — 항목 1점 · 칸 0.2점(원장 2026-10-21)", () => {
  it("원장 예시: 정확성 4 · 순서 3 · 이유 설명 1 · 용어 3 · 전달력 3칸 → 2.8점 · 다 채우면 5.0 · 한 칸씩이면 1.0", () => {
    expect(reviewPoints(s(4, 3, 1, 3, 3))).toBe(2.8);
    expect(reviewPoints(s(5, 5, 5, 5, 5))).toBe(5);
    expect(reviewPoints(s(1, 1, 1, 1, 1))).toBe(1);
    expect(reviewPoints(s(5, 5, 1, 5, 5))).toBe(4.2);
  });
  it("판단 보류 항목은 빼고 판단한 항목의 평균 칸으로 5점 만점 · 다 보류면 평점 없음 · 결과가 없으면 없음", () => {
    expect(reviewPoints(s(4, null, 2, null, 3))).toBe(3);
    expect(reviewPoints(s(null, null, null, null, null))).toBeNull();
    expect(reviewPoints(null)).toBeNull();
    expect(reviewPoints({})).toBeNull();
  });
  it("한 칸에 영상이 여럿이면 평점 있는 영상들의 평균", () => {
    expect(averagePoints([2.8, 4.2])).toBe(3.5);
    expect(averagePoints([null, 3, undefined])).toBe(3);
    expect(averagePoints([])).toBeNull();
  });
});
