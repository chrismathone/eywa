/**
 * 통계 패널 안쪽 격자 — 패널이 목록 **옆**(18rem)이면 한 줄로 쌓이고, 목록 **아래**로 접혀 넓어지면 카드가 2·3·4칸으로 나란히 선다
 * (넓은 폭에 카드 하나를 길게 늘이면 그래프·분해 표가 성겨 읽기 어렵다). 패널 상자(`@container/panel`)의 폭이 정한다.
 * 실표면(stats-panel.tsx)과 스켈레톤이 같은 격자를 쓴다(B7 — 스켈레톤 = 실표면과 같은 자리).
 */
export const STATS_PANEL_GRID =
  "grid grid-cols-1 items-start gap-4 @2xl/panel:grid-cols-2 @5xl/panel:grid-cols-3 @7xl/panel:grid-cols-4";

/** 통계 패널 자리 — 집계가 흘러오기 전에 같은 크기의 빈 표면을 먼저 세운다(B7 · 스켈레톤 = 실표면과 같은 라운드). */
export function StatsPanelSkeleton() {
  return (
    <div aria-hidden="true" className={STATS_PANEL_GRID}>
      <div className="bg-bg-soft/40 col-span-full h-10 w-2/3 max-w-xs animate-pulse rounded-lg" />
      <div className="bg-bg-soft/40 h-64 animate-pulse rounded-2xl" />
      <div className="bg-bg-soft/40 h-56 animate-pulse rounded-2xl" />
      <div className="bg-bg-soft/40 h-48 animate-pulse rounded-2xl" />
      <div className="bg-bg-soft/40 h-48 animate-pulse rounded-2xl" />
    </div>
  );
}
