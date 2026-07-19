// 시간표 기본뷰 '빈 교시 접기' — 행 높이 계산 순수 함수 (2026-07-19 C안).
//
// 수업이 하나도 없는 표준 교시 행을 **숨기지 않고 얇은 밴드로 축소**한다 — 교시 축의 연속성과
// 격자 지형이 유지된다. 접힌 높이는 CSS 변수(--tt-empty-h) 경유: 편집 모드에선 클라 래퍼
// (EmptyPeriodScope)가 변수를 풀 높이로 올려 서버 리렌더 없이 즉시 펼친다(드롭 존은 점유 셀
// 안에만 등록되지만, 접힌 격자는 평소와 지형이 달라 편집 시야를 왜곡하므로 원형 복원).
//
// ⚠️ rowSpan 병합 안전 근거: computeBlocks(grid.ts)는 빈 셀(key "")을 병합하지 않고, 수업 블록이
// 세로로 걸치는 행은 그 열에 슬롯이 있는(=점유) 행뿐이다 → **모든 병합 블록은 풀 높이 행만
// 걸친다**. 블록 높이 산식(rowSpan × ROW_H)은 접기와 무관하게 유지된다. 가변 높이가 필요한 곳은
// tr 자체와 수학계열 그룹 라벨(rowSpan=2, 교시 2행 합산)뿐 — 합산은 stackedHeights가 calc()로.

/** 기본뷰 교시 1칸 풀 높이(px) — weekday-group-tables ROW_H와 EmptyPeriodScope가 공유하는 단일 소스. */
export const PERIOD_ROW_H = 222;

/** 접힌 빈 교시 행 높이(px) — 교시 라벨 한 줄이 들어가는 최소 밴드. */
export const EMPTY_PERIOD_ROW_H = 36;

/**
 * 접힌 행 높이 CSS 값 — 변수 미설정 시 EMPTY_PERIOD_ROW_H 폴백.
 * 편집 모드에선 EmptyPeriodScope가 --tt-empty-h를 풀 높이로 설정해 접힌 행을 전부 펼친다.
 */
export const EMPTY_PERIOD_H = `var(--tt-empty-h, ${EMPTY_PERIOD_ROW_H}px)`;

/** 교시 행 1개의 높이 스타일 — 접힌 빈 행은 CSS 변수(편집 시 확장), 점유 행은 고정 px. */
export function periodRowHeight(collapsed: boolean, fullHeight: number): number | string {
  return collapsed ? EMPTY_PERIOD_H : fullHeight;
}

/**
 * 여러 교시 행에 걸친 셀(수학계열 그룹 라벨 rowSpan=2)의 높이 — 전부 숫자면 합산 px,
 * CSS 변수(접힌 행)가 섞이면 calc() 합산 문자열.
 */
export function stackedHeights(heights: (number | string)[]): number | string {
  if (heights.every((h) => typeof h === "number")) {
    return (heights as number[]).reduce((a, b) => a + b, 0);
  }
  return `calc(${heights.map((h) => (typeof h === "number" ? `${h}px` : h)).join(" + ")})`;
}
