/**
 * 보고서 표 열 폭 — 행 높이를 한 줄로 고정하고(원장 2026-11-09 *"행 크기 일정하게"*), 열은 내용에 맞춘다.
 * 짧은 열 = 그 열에서 가장 긴 값(또는 머리)에 맞춘 고정 폭 · 긴 글 열(메모·사유) = 남은 폭을 나눠 쓰고 넘치면 말줄임 + 마우스 오버 카드
 * (*"넘치는 내용을 우측으로 스크롤해야 확인할 수 있는데 열너비 알맞게 조절 … 나머지 넘치는 내용은 마우스 오버로"*).
 * 표가 그래도 창보다 넓어지는 것은 고정 폭 합 + 긴 글 열 최소 폭이 창보다 클 때뿐이다.
 */

/** 칸 좌우 여백(px-3 = 12 × 2). */
const CELL_PAD = 24;
/** 머리의 칸 여백(px-2 = 16) + 단추 여백(px-1 = 8) + 간격(4) + 정렬 화살표(14). */
const HEAD_EXTRA = 42;

/**
 * 표 글자(text-sm = 16px) 폭 어림 — 한글 16 · 그 밖 9. 축용 `textWidth`(14px)로 재면 표에선 모자라
 * 두 줄로 접은 머리가 실제로는 세 줄이 됐다(최종 리뷰 2026-11-11).
 */
function cellText(text: string): number {
  let w = 0;
  for (const ch of text) w += /[가-힣]/.test(ch) ? 16 : 9;
  return w;
}

/**
 * 머리를 두 줄로 접었을 때 더 긴 줄의 폭 — 한국어는 어절 단위로만 끊기므로(`break-keep`) 어절 사이 자리마다 나눠 본다.
 * 어절이 하나뿐이면 접을 수 없다(null).
 */
export function twoLineWidth(label: string): number | null {
  const words = label.trim().split(/\s+/);
  if (words.length < 2) return null;
  let best = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = cellText(words.slice(0, k).join(" "));
    const b = cellText(words.slice(k).join(" "));
    best = Math.min(best, Math.max(a, b));
  }
  return best;
}
/** 이보다 긴 열은 '긴 글 열' — 고정하지 않고 남은 폭을 나눈다. */
export const FIXED_MAX = 240;
/** 긴 글 열이 최소로 받는 폭. */
export const FLEX_MIN = 160;
/** 고정 열 최소 폭. */
const FIXED_MIN = 56;

/** `wrapHead` = 머리를 두 줄까지 접는다(머리 글이 값보다 훨씬 길 때 — 값에 맞춰 열을 좁힌다). */
export type ColumnFit = { width: number | null; wrapHead?: boolean };

/** 표에 한 줄로 보일 글 — 줄바꿈은 ' · '로 잇는다(원문 전체는 카드로). */
export function oneLine(text: string): string {
  return text.replace(/\s*\n+\s*/g, " · ").trim();
}

/**
 * 열마다 폭(px) 또는 null(긴 글 열). `texts`는 그 열의 표시 글 전부.
 * 원장 2026-11-11 *"열너비도 스마트하게 조절"* — 예전엔 머리 글이 길면(예: '담당 학생(분모)') 값이 짧아도 열이 머리만큼 넓어지거나
 * 긴 글 열로 넘어가 남은 폭을 나눠 가졌다. 이제 폭은 **값**이 정하고, 머리가 값보다 길면 머리를 두 줄로 접는다.
 */
export function fitColumn(label: string, texts: readonly string[]): ColumnFit {
  const head = cellText(label) + HEAD_EXTRA;
  let values = 0;
  for (const t of texts) {
    const w = cellText(oneLine(t)) + CELL_PAD;
    if (w > values) values = w;
    if (values > FIXED_MAX) return head > FLEX_MIN ? { width: null, wrapHead: true } : { width: null };
  }
  const base = Math.max(FIXED_MIN, Math.ceil(values));
  // 머리가 조금만 길면(접어서 얻는 폭이 작으면) 머리에 맞춘다 — '학년'처럼 짧은 머리를 두 줄로 접지 않는다.
  if (head <= base + WRAP_MIN_GAIN) return { width: Math.max(base, Math.ceil(head)) };
  // 머리가 더 길다 — 어절 단위로 두 줄에 실제로 들어가는 폭과 값 폭 중 넓은 쪽. 두 줄에 안 들어가면(어절 하나) 접지 않는다.
  const lines = twoLineWidth(label);
  if (lines === null) return { width: Math.min(Math.ceil(head), FIXED_MAX) };
  const width = Math.max(base, Math.ceil(lines) + HEAD_EXTRA);
  if (width > FIXED_MAX) return { width: Math.min(Math.ceil(head), FIXED_MAX) };
  return width + WRAP_MIN_GAIN <= Math.ceil(head) ? { width, wrapHead: true } : { width: Math.min(Math.ceil(head), FIXED_MAX) };
}
/** 머리를 접어 이만큼(px) 넘게 좁아질 때만 접는다. */
const WRAP_MIN_GAIN = 48;

/** 표 최소 폭 — 고정 열 합 + 긴 글 열마다 최소 폭. */
export function tableMinWidth(fits: readonly ColumnFit[]): number {
  return fits.reduce((sum, f) => sum + (f.width ?? FLEX_MIN), 0);
}

/** 이 칸 글이 칸에 다 안 보일 수 있나 — 긴 글 열은 최소 폭 기준으로 본다(실제 폭은 창에 따라 넓어질 수 있다). */
export function mayOverflow(text: string, fit: ColumnFit): boolean {
  if (text.includes("\n")) return true;
  if (fit.width !== null) return false;
  return cellText(text) + CELL_PAD > FLEX_MIN;
}
