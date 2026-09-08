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

/**
 * **셀 1개(수업 1개)의 고정 높이** — 기본뷰의 진짜 단위(2026-08-04 원장 지시: "셀 높이를 고정해버리면
 * 될 것 같은데, 유동적으로 하지 말고 수업명 얼마·학생리스트 얼마 식으로").
 *
 * 배분(전부 고정, 유동 계산 없음):
 *   수업명 헤더 존 60(= 2행 × 30, class-cell HEADER_H) + 학생 12행(12 × 23) + 셀 패딩 16 = 352
 * 대기·퇴원·요일칸(분리등원)이 생기면 이 **352 안에서** 각자 몫을 가져가고 재원 명단이 그만큼 줄어
 * 스크롤된다(셀 바깥으로 넘치지 않는다 = 행 높이가 흔들리지 않는다).
 * ⚠️ 바꿀 땐 HEADER_H·STU_ROW_H와 함께 다시 계산할 것. 12는 원장이 정한 표시 인원.
 */
export const CELL_H = 352;

/**
 * 기본뷰 교시 **행** 높이(px) — weekday-group-tables와 EmptyPeriodScope가 공유하는 단일 소스.
 *
 * 수학계열은 교시 2칸이 한 그룹(1교시 = 옛 1-1+1-2)이고 **셀 하나가 그룹 전체**를 쓴다
 * (반교시 수업도 `expandHalfPeriodBlocks`가 그룹 높이로 늘린다) → 행 높이 = 셀 높이의 절반.
 * 옛 222는 2교시 셀이 444px라 16명분을 잡아 놓고 대부분의 반이 못 채워 아래가 통째로 비었다.
 *
 * 영어·주말도 **같은 값**을 쓴다(2026-08-04 원장 확인): 영어는 같은 수업이 2~3교시 이어지고
 * (담당이 갈려도) 주말은 교시가 연달아 붙어서, 어차피 세로 병합으로 셀이 2칸+가 되기 때문이다.
 * → 과목별 분기 없음. 한 값으로 전부 간다.
 * ⏳ 다만 **영어 기본뷰는 정의가 더 필요하다**(원장, 2026-08-04) — 교시 그룹 개념이 없어 반교시
 *    확장(expandHalfPeriodBlocks)이 안 걸린다. 별건으로 다시 볼 것.
 */
export const PERIOD_ROW_H = CELL_H / 2;

/**
 * **학생 명단을 접었을 때의 셀 높이** — 수업명 헤더 존(HEADER_H 60) + 셀 패딩 16.
 * 명단만 감추고 높이를 그대로 두면 칸의 4/5가 빈 채로 남아 '접기'가 아무 소용이 없다(원장 2026-09-04).
 * ⚠️ CELL_H와 **같은 산식**을 쓴다 — 헤더 존이 바뀌면 둘 다 따라 움직여야 한다.
 */
export const NO_ROSTER_CELL_H = 76;

/** 명단을 접었을 때의 교시 행 높이(px) — 셀 높이와 같은 관계(수학계열은 교시 2칸이 한 셀). */
export const NO_ROSTER_PERIOD_ROW_H = NO_ROSTER_CELL_H / 2;

/** 교시 행 높이 — 명단을 접었으면 헤더만 남는 높이. 화면·스코프 래퍼가 같은 함수를 쓴다. */
export function periodRowFullHeight(hideStudents: boolean): number {
  return hideStudents ? NO_ROSTER_PERIOD_ROW_H : PERIOD_ROW_H;
}

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
