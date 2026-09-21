/**
 * 월간 계획서(MP) 인쇄물을 **A4 세로 한 장에 딱 맞추는** 규칙 — 순수(Vitest). 서버·클라가 함께 쓰므로
 * `server-only` 금지([[#61]]).
 *
 * 원장 2026-09-21 두 번:
 *  ① *"인쇄도 한페이지에 딱 들어오게 맞춰 A4"* — 그전엔 시트 픽셀을 그대로 찍어서 주 5일 반(15열 = 1,302px)이
 *     가로 A4를 넘어 금요일이 잘리고, 5주 달은 1.6장이 돼 5주차가 둘째 장으로 넘어갔다.
 *  ② *"A4가 가로사이즈에 맞는데, 세로 사이즈에 맞도록 비율 조정. 인쇄시에"* — 처음엔 방향을 문서마다 골랐는데
 *     (주 5일 반은 가로) 원장은 **세로 A4 한 장**을 원했다. 그래서 방향은 **세로 고정**이다.
 *
 * 🔑 맞추는 법은 둘을 겹친다:
 *  · **배율** = 문서 전체를 같은 비율로 줄여 폭(또는 높이)을 종이에 맞춘다(구글 시트 "페이지에 맞추기").
 *  · **비율** = 폭에 맞춰 줄이면 세로 A4 아래가 비는데(주 5일 반은 절반 가까이), 그 남는 높이를 **값 칸(계획을
 *    적는 큰 칸)에 나눠 준다** — 문서가 종이 세로를 꽉 채운다.
 * 🔴 **칸을 줄여서 맞추지 않는다** — 값 칸은 `overflow:hidden`이라 줄이면 적어 둔 계획이 종이에서 **조용히
 *    잘린다**(학부모 문서에서 그건 틀린 문서보다 나쁘다). 늘리는 쪽만 한다.
 * ⚠️ **키우지는 않는다**(배율 최대 100%) — 시트 원래 크기가 이 문서의 기준이다(남는 높이는 칸이 먹는다).
 */

/** 인쇄 여백(mm, 사방 같음) — 흔한 프린터의 비인쇄 영역(≈4~5mm)보다 넉넉하다. */
export const MP_PRINT_MARGIN_MM = 8;

/** 값 칸 높이를 싣는 CSS 변수 — 인쇄 껍데기가 재서 쓰고, 종이 컴포넌트가 읽는다(없으면 시트 기본 140px). */
export const MP_PRINT_VALUE_VAR = "--mp-value-h";

/** CSS px ↔ mm(96dpi — 브라우저 인쇄의 기준 해상도). */
const PX_PER_MM = 96 / 25.4;
const A4_MM = { width: 210, height: 297 } as const;

/**
 * 반올림·서브픽셀 때문에 마지막 한 줄이 **빈 둘째 장**으로 넘어가지 않게 두는 여유(2%).
 * ⚠️ 1로 올리지 말 것 — 측정값은 정수로 반올림된 px라 딱 맞추면 브라우저가 한 줄을 넘긴다.
 */
const SAFETY = 0.98;

export type MpPrintFit = {
  /** 문서 전체 배율(0~1). */
  zoom: number;
  /** 값 칸 한 줄의 높이(px, 배율 적용 전). 남는 높이가 없으면 시트 기본값 그대로. */
  valuePx: number;
};

/** 세로 A4에서 여백을 뺀 인쇄 영역(px). */
export function mpPrintArea(): { width: number; height: number } {
  return {
    width: (A4_MM.width - 2 * MP_PRINT_MARGIN_MM) * PX_PER_MM,
    height: (A4_MM.height - 2 * MP_PRINT_MARGIN_MM) * PX_PER_MM,
  };
}

/**
 * 문서의 원래 크기(px, 값 칸이 기본 높이일 때) → 세로 A4 한 장에 들어가는 배율 + 값 칸 높이.
 *
 * `valueRows` = 값 칸 줄 수(주 수), `basePx` = 그 줄의 기본 높이(시트 140px).
 * 깨진 입력(0·음수·NaN — 아직 그려지기 전)은 **손대지 않는다**(배율 1, 기본 높이).
 */
export function mpPrintFit(
  doc: { width: number; height: number },
  rows: { valueRows: number; basePx: number },
): MpPrintFit {
  const base = rows.basePx > 0 ? rows.basePx : 0;
  if (!(doc.width > 0 && doc.height > 0)) return { zoom: 1, valuePx: base };
  const area = mpPrintArea();
  const fit = Math.min(1, area.width / doc.width, area.height / doc.height) * SAFETY;
  // 소수 셋째 자리에서 **내림** — 올리면 여유를 갉아먹는다.
  const zoom = Math.floor(fit * 1000) / 1000;
  // 줄인 뒤 종이 세로에 남는 높이(배율 적용 전 px) → 값 칸에 고르게 나눈다(정수로 내림 — 넘치지 않게).
  const spare = (area.height * SAFETY) / zoom - doc.height;
  const extra = rows.valueRows > 0 && spare > 0 ? Math.floor(spare / rows.valueRows) : 0;
  return { zoom, valuePx: base + extra };
}

/** 인쇄 페이지 상자 — 세로 A4 + 여백. 전역 `@media print @page`(시간표용 가로)보다 **뒤에** 놓여야 이긴다. */
export function mpPrintPageCss(): string {
  return `@page { size: A4 portrait; margin: ${MP_PRINT_MARGIN_MM}mm; }`;
}

/** 값 칸 높이 — 변수가 없으면(맞춤 전·화면 외) 시트 기본값. */
export function mpPrintValueHeight(basePx: string): string {
  return `var(${MP_PRINT_VALUE_VAR}, ${basePx})`;
}

/** 화면 미리보기 위 한 줄 — 몇 %로 줄였는지 말한다(글씨가 작아진 이유를 숨기지 않는다). */
export function mpPrintFitCaption(fit: MpPrintFit): string {
  return `A4 세로 한 장에 맞춤 · ${Math.round(fit.zoom * 100)}%`;
}
