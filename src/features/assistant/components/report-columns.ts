import { textWidth } from "./report-format";

/**
 * 보고서 표 열 폭 — 행 높이를 한 줄로 고정하고(원장 2026-11-09 *"행 크기 일정하게"*), 열은 내용에 맞춘다.
 * 짧은 열 = 그 열에서 가장 긴 값(또는 머리)에 맞춘 고정 폭 · 긴 글 열(메모·사유) = 남은 폭을 나눠 쓰고 넘치면 말줄임 + 마우스 오버 카드
 * (*"넘치는 내용을 우측으로 스크롤해야 확인할 수 있는데 열너비 알맞게 조절 … 나머지 넘치는 내용은 마우스 오버로"*).
 * 표가 그래도 창보다 넓어지는 것은 고정 폭 합 + 긴 글 열 최소 폭이 창보다 클 때뿐이다.
 */

/** 칸 좌우 여백(px-3 = 12 × 2). */
const CELL_PAD = 24;
/** 머리의 정렬 화살표 + 간격 + 버튼 여백. */
const HEAD_EXTRA = 30;
/** 이보다 긴 열은 '긴 글 열' — 고정하지 않고 남은 폭을 나눈다. */
export const FIXED_MAX = 240;
/** 긴 글 열이 최소로 받는 폭. */
export const FLEX_MIN = 160;
/** 고정 열 최소 폭. */
const FIXED_MIN = 56;

export type ColumnFit = { width: number | null };

/** 표에 한 줄로 보일 글 — 줄바꿈은 ' · '로 잇는다(원문 전체는 카드로). */
export function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, " · ").trim();
}

/** 열마다 폭(px) 또는 null(긴 글 열). `texts`는 그 열의 표시 글 전부. */
export function fitColumn(label: string, texts: readonly string[]): ColumnFit {
  let widest = textWidth(label) + HEAD_EXTRA;
  for (const t of texts) {
    const w = textWidth(oneLine(t)) + CELL_PAD;
    if (w > widest) widest = w;
    if (widest > FIXED_MAX) return { width: null };
  }
  return { width: Math.max(FIXED_MIN, Math.ceil(widest)) };
}

/** 표 최소 폭 — 고정 열 합 + 긴 글 열마다 최소 폭. */
export function tableMinWidth(fits: readonly ColumnFit[]): number {
  return fits.reduce((sum, f) => sum + (f.width ?? FLEX_MIN), 0);
}

/** 이 칸 글이 칸에 다 안 보일 수 있나 — 긴 글 열은 최소 폭 기준으로 본다(실제 폭은 창에 따라 넓어질 수 있다). */
export function mayOverflow(text: string, fit: ColumnFit): boolean {
  if (text.includes("\n")) return true;
  if (fit.width !== null) return false;
  return textWidth(text) + CELL_PAD > FLEX_MIN;
}
