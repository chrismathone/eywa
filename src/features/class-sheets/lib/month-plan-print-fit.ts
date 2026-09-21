/**
 * 월간 계획서(MP) 인쇄물을 **A4 한 장에 딱 맞추는** 규칙 — 순수(Vitest). 서버·클라가 함께 쓰므로
 * `server-only` 금지([[#61]]).
 *
 * 원장 2026-09-21: *"인쇄도 한페이지에 딱 들어오게 맞춰 A4"* — 그전엔 시트 픽셀을 그대로 찍어서
 * 주 5일 반(15열 = 1,302px)이 가로 A4(여백 뺀 1,047px)를 넘어 금요일이 잘리고, 5주 달은 세로로
 * 1.6장이 돼 5주차가 둘째 장으로 넘어갔다(CLAUDE.md MP 항목의 "A4 한 장은 지금 사실이 아니다").
 *
 * 🔑 **문서 전체를 같은 비율로 줄인다**(구글 시트의 "페이지에 맞추기"와 같다). 칸 높이만 줄이는 식으로
 *    비율을 바꾸지 않는 이유: 값 칸은 `overflow:hidden`이라 줄이면 적어 둔 계획이 종이에서 **조용히
 *    잘린다** — 학부모 문서에서 그건 틀린 문서보다 나쁘다. 비율 축소는 아무것도 자르지 않는다.
 * 🔑 **방향은 더 크게 찍히는 쪽**을 고른다. 주 3일 반(EiE 15개 중 13개)은 세로가 훨씬 크게 나오고
 *    (5주 기준 가로 64% → 세로 약 90%), 주 5일 반은 가로가 낫다. 방향을 하나로 못박으면 대부분의 반이
 *    필요 이상으로 작은 글씨를 받는다.
 * ⚠️ **키우지는 않는다**(최대 100%) — 시트 원래 크기가 이 문서의 기준이다.
 */

/** 인쇄 여백(mm, 사방 같음) — 흔한 프린터의 비인쇄 영역(≈4~5mm)보다 넉넉하다. */
export const MP_PRINT_MARGIN_MM = 8;

/** CSS px ↔ mm(96dpi — 브라우저 인쇄의 기준 해상도). */
const PX_PER_MM = 96 / 25.4;
const A4_MM = { long: 297, short: 210 } as const;

/**
 * 반올림·서브픽셀 때문에 마지막 한 줄이 **빈 둘째 장**으로 넘어가지 않게 두는 여유(2%).
 * ⚠️ 1로 올리지 말 것 — 측정값은 정수로 반올림된 px라 딱 맞추면 브라우저가 한 줄을 넘긴다.
 */
const SAFETY = 0.98;

export type MpPrintOrientation = "landscape" | "portrait";
export type MpPrintFit = { zoom: number; orientation: MpPrintOrientation };

/** 그 방향에서 여백을 뺀 인쇄 영역(px). */
export function mpPrintArea(orientation: MpPrintOrientation): { width: number; height: number } {
  const w = orientation === "landscape" ? A4_MM.long : A4_MM.short;
  const h = orientation === "landscape" ? A4_MM.short : A4_MM.long;
  return {
    width: (w - 2 * MP_PRINT_MARGIN_MM) * PX_PER_MM,
    height: (h - 2 * MP_PRINT_MARGIN_MM) * PX_PER_MM,
  };
}

/**
 * 문서의 원래 크기(px) → 한 장에 들어가는 배율 + 방향.
 * 깨진 입력(0·음수·NaN — 아직 그려지기 전)은 **손대지 않는다**(배율 1, 가로).
 */
export function mpPrintFit(doc: { width: number; height: number }): MpPrintFit {
  if (!(doc.width > 0 && doc.height > 0)) return { zoom: 1, orientation: "landscape" };
  const scaleFor = (o: MpPrintOrientation) => {
    const area = mpPrintArea(o);
    return Math.min(area.width / doc.width, area.height / doc.height);
  };
  const land = scaleFor("landscape");
  const port = scaleFor("portrait");
  // 같으면 가로(종전 방향) — 세로는 **실제로 더 클 때만** 고른다.
  const orientation: MpPrintOrientation = port > land ? "portrait" : "landscape";
  const best = Math.min(1, Math.max(land, port)) * SAFETY;
  // 소수 셋째 자리에서 **내림** — 올리면 여유를 갉아먹는다.
  return { zoom: Math.floor(best * 1000) / 1000, orientation };
}

/**
 * 인쇄 페이지 상자 — 방향이 문서마다 달라서 **문서가 직접** 선언한다.
 * ⚠️ 전역 `@media print @page`(시간표용 가로 12mm)보다 **뒤에** 놓여야 이긴다 — 본문 안 `<style>`이라 항상 뒤다.
 */
export function mpPrintPageCss(orientation: MpPrintOrientation): string {
  return `@page { size: A4 ${orientation}; margin: ${MP_PRINT_MARGIN_MM}mm; }`;
}

/** 화면 미리보기 위 한 줄 — 몇 %로 줄였는지 말한다(글씨가 작아진 이유를 숨기지 않는다). */
export function mpPrintFitCaption(fit: MpPrintFit): string {
  const dir = fit.orientation === "landscape" ? "가로" : "세로";
  return `A4 ${dir} 한 장에 맞춤 · ${Math.round(fit.zoom * 100)}%`;
}
