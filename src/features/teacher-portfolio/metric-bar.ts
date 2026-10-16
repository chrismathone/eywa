/**
 * 항목 막대의 모양(퍼센트) — 만점 대비 왼쪽부터 채우는 막대, 또는 가감·음수 항목의 **0을 가운데 둔 막대**(원장 2026-10-16
 * *"중간을 0점으로 잡고 좌우 비례해서 + - 표시해줘. 2점인데도 표시가 안보이네"*). 그리는 쪽(`score-hero.tsx`)은 left·width를 그대로 쓴다.
 */
export const SIGNED_SWING = 5;
export type MetricBar = { signed: boolean; left: number; width: number; before: number | null };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * `axis` = 가운데 축으로 그릴지 — 화면은 보이는 달 전체로 항목마다 한 번 정해 넘긴다(달을 바꿀 때 축이 바뀌어 막대가 미끄러지지 않게 ·
 * 재리뷰 2026-10-16). 없으면 만점이 없거나(가감) 이번 달·전월이 음수일 때 — 만점 막대는 음수를 0으로 잘라 감점이 안 보였다.
 */
export function metricBar(
  value: number | null, before: number | null | undefined, max: number, axis: boolean = max <= 0 || (value ?? 0) < 0 || (before ?? 0) < 0,
): MetricBar {
  const signed = axis;
  // 가운데 축의 한쪽 끝 = 만점(있으면) 또는 ±5점 — 값이 더 크면 끝이 그 값까지 늘어난다.
  const swing = max > 0 ? max : Math.max(SIGNED_SWING, Math.abs(value ?? 0), Math.abs(before ?? 0));
  const at = (n: number) => (signed ? 50 + clamp((n / swing) * 50, -50, 50) : clamp((n / max) * 100, 0, 100));
  const end = value === null ? (signed ? 50 : 0) : at(value);
  return {
    signed, left: signed ? Math.min(50, end) : 0, width: signed ? Math.abs(end - 50) : end,
    before: before === null || before === undefined ? null : at(before),
  };
}
