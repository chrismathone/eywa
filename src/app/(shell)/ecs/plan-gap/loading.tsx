/**
 * 계획 대비 현황 스켈레톤(B7) — 실화면과 같은 골격(머리 · 툴바 · 통계 4칸 · 표)이라 로딩→본문에서 안 튄다.
 */
export default function EcsPlanGapLoading() {
  return (
    <div className="space-y-4">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-24 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-40 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-96 animate-pulse rounded" />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 animate-pulse rounded-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-20 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="bg-card shadow-card space-y-2 rounded-2xl p-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-10 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
