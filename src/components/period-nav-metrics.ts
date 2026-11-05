/**
 * 기간 이동 네비 치수 — 실물 [`PeriodNav`](./period-nav.tsx)와 스켈레톤 [`PeriodNavSkeleton`](./period-nav-skeleton.tsx)이
 * **같은 값**을 쓴다(2026-11-05 스켈레톤 2차 검수: 스켈레톤들이 라벨 폭 계수 `×1.4`를 베껴 적어 계수가 바뀌면 갈릴 자리였다).
 * 🔴 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트인 `loading.tsx`가 스켈레톤을 통해 읽는다([[#81]]).
 */

/** 호출부가 `labelWidth`를 안 주면 쓰는 값(옛 13px 라벨 기준 px). */
export const PERIOD_NAV_LABEL_BASE = 112;

/**
 * 라벨 칸의 **고정** 폭(px). 호출부의 labelWidth는 옛 13px 라벨에 맞춘 값이라 v5 라벨(18px)에 맞춰 1.4배로 도출한다
 * (원장 2026-09-01 "이동해도 크기 변동 안 되고 고정되게" — 최소 폭이면 글자 수가 바뀔 때 화살표가 움찔한다).
 */
export function periodNavLabelWidth(base: number = PERIOD_NAV_LABEL_BASE): number {
  return Math.ceil(base * 1.4);
}

/** 네비 한 덩어리(상자 + 과거/미래 배지)의 줄. */
export const PERIOD_NAV_ROW = "flex shrink-0 items-center gap-1.5";
/** 화살표·라벨을 담는 테두리 상자 — 높이는 컨트롤 변수. */
export const PERIOD_NAV_BOX = "border-line-strong inline-flex h-(--control-h) items-center overflow-hidden rounded-lg border";
/** 화살표 칸의 상자(색·상태 톤은 실물이 얹는다). */
export const PERIOD_NAV_ARROW_BOX = "inline-flex h-full items-center justify-center px-2";
/** 화살표 아이콘 크기 = 컨트롤 라벨 1em. */
export const PERIOD_NAV_ARROW_ICON = "size-[1em] text-(length:--control-label)";
/** 가운데 라벨 칸의 상자(양옆 구분선). */
export const PERIOD_NAV_LABEL_BOX = "border-line-faint h-full shrink-0 border-x";
