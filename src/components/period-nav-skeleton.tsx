import {
  PERIOD_NAV_ARROW_BOX,
  PERIOD_NAV_ARROW_ICON,
  PERIOD_NAV_BOX,
  PERIOD_NAV_LABEL_BOX,
  PERIOD_NAV_ROW,
  periodNavLabelWidth,
} from "./period-nav-metrics";

/**
 * 기간 이동 네비 자리 스켈레톤 — `loading.tsx`에서 `‹ 라벨 ›`을 `w-56` 같은 손 폭으로 그리지 말고 이것을 쓴다.
 * 실물 [`PeriodNav`](./period-nav.tsx)와 같은 치수 상수(period-nav-metrics.ts) — 화살표 둘 + 고정 폭 라벨이라 폭이 실물과 같다
 * (2026-11-05 2차 검수: ECS 시트 상단 바가 손 폭이라 실물보다 짧아 실물만 두 줄로 감겼다).
 * - `labelWidth` — 실물 호출부에 준 값 그대로(안 주면 실물 기본값). 폰 전용 짧은 라벨(`mobileLabel`)은 따르지 않는다.
 * 과거/미래 배지는 그리지 않는다(가장 흔한 첫 화면 = 이번 기간).
 * 🔴 이 파일에 `"use client"`를 붙이지 말 것.
 */
export function PeriodNavSkeleton({ labelWidth }: { labelWidth?: number }) {
  const arrow = (
    <span className={PERIOD_NAV_ARROW_BOX}>
      <span className={`block ${PERIOD_NAV_ARROW_ICON}`} />
    </span>
  );
  return (
    <div aria-hidden className={PERIOD_NAV_ROW}>
      <div className={`${PERIOD_NAV_BOX} bg-bg-soft animate-pulse`}>
        {arrow}
        <span className={PERIOD_NAV_LABEL_BOX} style={{ width: periodNavLabelWidth(labelWidth) }} />
        {arrow}
      </div>
    </div>
  );
}
