import { describe, expect, it } from "vitest";
import { goalFillColor } from "./goal-rail-bar";

// 원장 2026-09-14 "목표진도만 채워질수록 진한 빨간색. 현재진도는 지금 그대로"
describe("목표진도 채움 색 — 채울수록 진한 빨강", () => {
  it("채움 비율이 진한 끝(--att-holiday-ink)의 섞는 비율이 된다", () => {
    expect(goalFillColor(0)).toContain("var(--att-holiday-ink) 0%");
    expect(goalFillColor(58)).toContain("var(--att-holiday-ink) 58%");
    expect(goalFillColor(100)).toContain("var(--att-holiday-ink) 100%");
  });

  it("옅은 끝은 --danger를 카드 바탕에 섞은 색 — 새 색 값을 적지 않는다", () => {
    const c = goalFillColor(40);
    expect(c).toContain("var(--danger) 35%");
    expect(c).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  it("범위 밖·비정상 값은 0~100으로 자른다", () => {
    expect(goalFillColor(-20)).toContain("var(--att-holiday-ink) 0%");
    expect(goalFillColor(140)).toContain("var(--att-holiday-ink) 100%");
    expect(goalFillColor(Number.NaN)).toContain("var(--att-holiday-ink) 0%");
    expect(goalFillColor(33.6)).toContain("var(--att-holiday-ink) 34%");
  });
});
