import { describe, expect, it } from "vitest";
import { learningAxisPosition } from "./learning-axis";

describe("목표 단계 수직선", () => {
  it("한 목표는 끝이 1이고 그 안의 실제 진도는 소수다", () => {
    const stops = [{ blockCount: 24 }];
    expect(learningAxisPosition(6, stops)).toBe(0.25);
    expect(learningAxisPosition(24, stops)).toBe(1);
  });
  it("서로 다른 분량의 목표도 각각 한 칸을 차지한다", () => {
    const stops = [24, 72, 96, 120].map(blockCount => ({ blockCount }));
    expect([24, 72, 96, 120].map(block => learningAxisPosition(block, stops))).toEqual([1, 2, 3, 4]);
    expect(learningAxisPosition(48, stops)).toBe(1.5);
  });
  it("n차 목표를 추가해도 기존 현재 진도의 수직선 값은 유지된다", () => {
    const stops = [24, 48, 72, 96].map(blockCount => ({ blockCount }));
    expect(learningAxisPosition(36, stops)).toBe(1.5);
    expect(learningAxisPosition(36, [...stops, { blockCount: 120 }])).toBe(1.5);
    expect(learningAxisPosition(150, stops)).toBe(4);
    expect(learningAxisPosition(-1, stops)).toBe(0);
  });
});
