import { SCORE_KEYS, type ScoreKey } from "./types";

/**
 * AI 참고 평점(5점 만점) — 다섯 항목이 각 1점, 항목마다 5칸이라 한 칸 = 0.2점(원장 2026-10-21 "각 1점으로 생각한 다음 5단계를 0.2점씩" —
 * 정확성 4 · 순서 3 · 이유 설명 1 · 용어 3 · 전달력 3칸 → 2.8점). AI가 판단을 보류한 항목(`null`)은 빼고 판단한 항목의 평균 칸 수로 5점 만점을
 * 맞춘다(보류를 0칸으로 세면 영상이 흐려서 못 본 것이 낮은 점수가 된다) — 다섯 항목이 다 있으면 위 공식과 같다. 판단한 항목이 없으면 null.
 * 소수 첫째 자리까지.
 */
export function reviewPoints(scores: Partial<Record<ScoreKey, { score: number | null } | undefined>> | null | undefined): number | null {
  if (!scores) return null;
  const judged = SCORE_KEYS.map((k) => scores[k]?.score).filter((s): s is number => typeof s === "number" && Number.isFinite(s));
  if (!judged.length) return null;
  const mean = judged.reduce((sum, s) => sum + Math.min(5, Math.max(0, s)), 0) / judged.length;
  return Math.round(mean * 10) / 10;
}

/** 평점의 정수 부분 → 색 단계(1~5). 0점대는 1단계. */
export function pointsTier(points: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.floor(points))) as 1 | 2 | 3 | 4 | 5;
}

/**
 * 단계 색 — 저득점 파랑 → 고득점 빨강으로 25%씩 섞는다(원장 2026-10-21 "정수부분의 숫자에 따라서 색깔이 그라데이션으로 · 고득점은 빨강, 저득점은 파랑").
 * 토큰(`--blue`·`--danger`)만 섞는다. 장부 칸 아래 줄과 AI 참고 메모 머리가 같은 색을 쓴다.
 */
export const POINTS_TIER_COLOR: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "var(--blue)",
  2: "color-mix(in oklch, var(--danger) 25%, var(--blue))",
  3: "color-mix(in oklch, var(--danger) 50%, var(--blue))",
  4: "color-mix(in oklch, var(--danger) 75%, var(--blue))",
  5: "var(--danger)",
};

/** 한 칸에 영상이 여럿이면(한 숙제에 여러 단원) 평점이 있는 영상들의 평균 — 없으면 null. */
export function averagePoints(points: readonly (number | null | undefined)[]): number | null {
  const known = points.filter((p): p is number => typeof p === "number");
  return known.length ? Math.round((known.reduce((a, b) => a + b, 0) / known.length) * 10) / 10 : null;
}
