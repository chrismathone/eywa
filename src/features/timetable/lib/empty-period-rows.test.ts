import { describe, expect, it } from "vitest";
import {
  CELL_H,
  EMPTY_PERIOD_H,
  EMPTY_PERIOD_ROW_H,
  NO_ROSTER_CELL_H,
  NO_ROSTER_PERIOD_ROW_H,
  PERIOD_ROW_H,
  periodRowFullHeight,
  periodRowHeight,
  stackedHeights,
} from "./empty-period-rows";

describe("empty-period-rows ('빈 교시 접기' 행 높이)", () => {
  it("점유 행 = 고정 px 숫자 그대로", () => {
    // ⚠️ 값을 리터럴로 박지 않는다 — 여기서 검증할 것은 "점유 행은 준 높이를 그대로 돌려준다"이지
    // 교시 높이가 몇 px인가가 아니다(옛 222 리터럴은 높이를 튜닝할 때마다 무관한 실패를 냈다).
    expect(periodRowHeight(false, PERIOD_ROW_H)).toBe(PERIOD_ROW_H);
    expect(periodRowHeight(false, 100)).toBe(100);
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

describe("명단 접기 — 셀 높이가 헤더 존을 지킨다", () => {
  it("접힌 셀 높이 = 헤더 존 + 셀 패딩(하드코딩 76이 아니라 산식)", () => {
    // class-cell의 HEADER_H(30×2) + 셀 패딩 16. 헤더 존이 바뀌면 이 테스트가 먼저 깨진다.
    expect(NO_ROSTER_CELL_H).toBe(60 + 16);
    expect(NO_ROSTER_PERIOD_ROW_H).toBe(NO_ROSTER_CELL_H / 2);
  });
  it("펼친 셀 높이 = 헤더 60 + 학생 12행(23) + 패딩 16", () => {
    expect(CELL_H).toBe(60 + 12 * 23 + 16);
    expect(PERIOD_ROW_H).toBe(CELL_H / 2);
  });
  it("행 높이는 접힘 여부를 따라간다", () => {
    expect(periodRowFullHeight(false)).toBe(PERIOD_ROW_H);
    expect(periodRowFullHeight(true)).toBe(NO_ROSTER_PERIOD_ROW_H);
  });
});
