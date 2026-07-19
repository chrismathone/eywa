import { describe, expect, it } from "vitest";
import {
  EMPTY_PERIOD_H,
  EMPTY_PERIOD_ROW_H,
  PERIOD_ROW_H,
  periodRowHeight,
  stackedHeights,
} from "./empty-period-rows";

describe("empty-period-rows ('빈 교시 접기' 행 높이)", () => {
  it("점유 행 = 고정 px 숫자 그대로", () => {
    expect(periodRowHeight(false, PERIOD_ROW_H)).toBe(222);
  });

  it("접힌 빈 행 = CSS 변수(편집 모드 확장 통로) + 폴백은 접힌 높이", () => {
    expect(periodRowHeight(true, PERIOD_ROW_H)).toBe(EMPTY_PERIOD_H);
    expect(EMPTY_PERIOD_H).toBe(`var(--tt-empty-h, ${EMPTY_PERIOD_ROW_H}px)`);
  });

  it("그룹 라벨 합산 — 두 행 다 점유면 숫자 합(px)", () => {
    expect(stackedHeights([222, 222])).toBe(444);
  });

  it("그룹 라벨 합산 — 접힌 행이 섞이면 calc() 문자열(변수 보존 = 편집 확장 시 자동 재계산)", () => {
    expect(stackedHeights([222, EMPTY_PERIOD_H])).toBe(`calc(222px + ${EMPTY_PERIOD_H})`);
    expect(stackedHeights([EMPTY_PERIOD_H, EMPTY_PERIOD_H])).toBe(
      `calc(${EMPTY_PERIOD_H} + ${EMPTY_PERIOD_H})`,
    );
  });
});
