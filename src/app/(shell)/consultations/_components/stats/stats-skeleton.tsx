/**
 * 통계 화면 격자(원장 2026-10-01 — 통계는 목록 옆이 아니라 **전용 화면**). 카드 넷(지표 · 추이 · 분해 · 상담 공백)이 폭에 따라
 * 1칸 → 2칸(지표|추이, 분해|공백) → 3칸(지표 1 + 추이 2, 분해 2 + 공백 1)으로 **빈 칸 없이** 선다. 같은 줄 카드는 높이를 맞춘다
 * (추이 카드는 공용 차트 높이로, 분해 카드는 기준 문구가 바닥까지 — 빈 띠가 남지 않게). 간격은 한 값(gap-4).
 * 통계 화면 루트(`@container/panel`)의 폭이 정한다. 실표면(stats-panel.tsx)과 스켈레톤이 같은 격자를 쓴다(B7).
 */
export const STATS_PANEL_GRID = "grid grid-cols-1 items-stretch gap-4 @2xl/panel:grid-cols-2 @5xl/panel:grid-cols-3";

/** 통계 자리 — 집계가 흘러오기 전에 같은 격자·같은 칸 배치의 빈 표면을 먼저 세운다(B7 · 스켈레톤 = 실표면과 같은 라운드). */
export function StatsPanelSkeleton() {
  return (
    <div aria-hidden="true" className={STATS_PANEL_GRID}>
      <div className="bg-bg-soft/40 col-span-full h-10 w-2/3 max-w-xs animate-pulse rounded-lg" />
      {/* 추이 카드 = 머리 + 공용 차트 300px + 각주 ≈ 400px(2026-10-21 공용 차트로 바꾸며 h-72 → h-100 · 첫 줄이 밀리지 않게). */}
      <div className="bg-bg-soft/40 h-100 animate-pulse rounded-2xl" />
      <div className="bg-bg-soft/40 h-100 animate-pulse rounded-2xl @5xl/panel:col-span-2" />
      {/* 분해·상담 공백 카드는 숨겼다(2026-10-28) — 담임별 현황이 바로 아래로 온다. */}
      {/* 담임별 상담 현황(전폭). */}
      <div className="bg-bg-soft/40 col-span-full h-64 animate-pulse rounded-2xl" />
    </div>
  );
}
