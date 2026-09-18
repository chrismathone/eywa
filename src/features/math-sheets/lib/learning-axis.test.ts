import { describe, expect, it } from "vitest";
import { learningAxisPosition, learningAxisTicks } from "./learning-axis";

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

describe("실제 블록 단위 눈금", () => {
  it("한 학기는 정확히 12칸이고 목표 끝은 1이다", () => {
    const ticks = learningAxisTicks([{ blockCount: 12 }]);
    expect(ticks).toHaveLength(12);
    expect(ticks[0]).toEqual({ block: 1, position: 1 / 12, goal: false });
    expect(ticks.at(-1)).toEqual({ block: 12, position: 1, goal: true });
  });
  it("1학기·2학기 분량의 목표를 각각 12칸·24칸으로 나눈다", () => {
    const stops = [{ blockCount: 12 }, { blockCount: 36 }];
    const ticks = learningAxisTicks(stops);
    expect(ticks.filter((tick) => tick.position <= 1)).toHaveLength(12);
    expect(ticks.filter((tick) => tick.position > 1)).toHaveLength(24);
    expect(ticks[12].position).toBe(1 + 1 / 24);
    for (const tick of ticks) expect(tick.position).toBe(learningAxisPosition(tick.block, stops));
  });
  it("복습 목표는 실제 4블록이며 미설정이면 눈금이 없다", () => {
    expect(learningAxisTicks([{ blockCount: 4 }])).toHaveLength(4);
    expect(learningAxisTicks([])).toEqual([]);
  });
});
