/**
 * 시간표 격자 칸이 자기 좌표를 다는 **DOM 속성 이름** — 반 블록 이동이 포인터 아래 칸을 찾고
 * "이 블록이 이 자리에 들어가나"를 계산하는 데 쓴다(id 문자열 파싱 금지).
 *
 * 🔴 **이 상수들은 "use client" 파일에 두지 말 것**([[#81]]) — 격자를 그리는
 *    `weekday-group-tables.tsx`는 **서버 컴포넌트**라, 클라 모듈에서 import하면 런타임에 `undefined`가 되어
 *    속성이 통째로 안 붙는다(타입체크·lint·테스트는 전부 통과한다). 실제로 한 번 그렇게 깨졌고,
 *    증상은 "갈 수 있는 칸이 0개 · 전 칸이 '이 자리엔 안 들어갑니다'"였다.
 */

/** 이 칸의 요일(`mon`…). */
export const CELL_DAY_ATTR = "data-cell-day";
/** 이 칸 교시의 시작시각(`HH:MM:SS`). */
export const CELL_START_ATTR = "data-cell-start";
/** 이 칸이 어느 표(평일 `wd` · 주말 `we`)인가 — 교시 행 목록은 표마다 다르다. */
export const CELL_GRID_ATTR = "data-cell-grid";
/** 이 칸이 그 표의 몇 번째 교시 행인가(0부터). */
export const CELL_ROW_ATTR = "data-cell-row";
/** 이 칸이 속한 요일 그룹(`mon,thu`) — 블록이 두 요일을 쓰면 그 옆 요일이 필요하다. */
export const CELL_DAYS_ATTR = "data-cell-days";
/** 그룹 안에서 이 칸의 요일이 몇 번째인가. */
export const CELL_DAYIDX_ATTR = "data-cell-dayidx";
/** 이 칸이 어느 열 묶음(그룹:강사)인가 — 이웃 칸을 **같은 열 묶음**에서만 찾기 위해. */
export const CELL_COL_ATTR = "data-cell-col";
/** 갈 수 있는 칸에만 붙는다(`"1"`). */
export const CELL_OK_ATTR = "data-cell-ok";
/** 포인터가 올라간 칸(블록이 여러 칸이면 그 칸들 전부). */
export const CELL_HOT_ATTR = "data-cell-hot";
/**
 * **못 가는 칸**에 붙는다(원장 2026-09-09 *"반 드래그도 마찬가지. 이동 불가능한 곳은 사전 차단."*).
 *
 * 🔴 2026-09-04의 "갈 수 있는 칸만 칠한다"를 원장이 명시로 뒤집은 것이다 — 되돌리지 말 것. 다만 색이
 *    아니라 **빗금**이라 화면이 경고로 뒤덮이지 않는다(빗금 = "여긴 자리가 아니다", 초록 = "여기로 가라").
 * ⚠️ '제자리'(SAME_SPOT)는 막힌 게 아니라 취소라 이 표식을 붙이지 않는다 — 붙이면 원래 자리가 금지 구역으로
 *    보인다. 빗금 그림은 globals.css `[data-drag-blocked]` 한 곳(격자 칸과 반 카드가 같은 표식을 쓴다).
 */
export const DRAG_BLOCKED_ATTR = "data-drag-blocked";

/**
 * 반 **카드** 칸이 다는 좌표 — 학생을 끌 때 "이 반엔 못 간다"를 DOM에 직접 칠하기 위한 것
 * (격자 칸의 `data-cell-*`와 같은 수법·같은 이유: 칸마다 React를 돌리면 그게 곧 픽업 렉이다).
 * 🔴 판정 단위는 **반**이라 `id`가 열쇠다 — 한 반이 여러 칸(요일·교시)으로 그려지므로 막힐 땐 전부 함께 막힌다.
 */
export const CLASS_CELL_ID_ATTR = "data-class-id";
export const CLASS_CELL_NAME_ATTR = "data-class-name";
export const CLASS_CELL_DAY_ATTR = "data-class-day";
export const CLASS_CELL_START_ATTR = "data-class-start";
export const CLASS_CELL_END_ATTR = "data-class-end";

/** 표 자신의 식별자(`wd`·`we`). */
export const GRID_ID_ATTR = "data-grid";
/**
 * 그 표의 교시 행 시작시각을 **순서대로**(`16:20:00,17:00:00,…`).
 * 🔴 칸에서 되짚지 말 것 — 모든 열이 위쪽 rowSpan에 덮인 행은 칸이 하나도 없어 그 행이 빠지고,
 *    두 교시를 쓰는 블록이 "여기엔 안 들어간다"로 잘못 잠긴다.
 */
export const GRID_ROWS_ATTR = "data-grid-rows";
