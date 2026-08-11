/**
 * ECS 랜딩 스켈레톤(B7) — 실표면과 동일 라운드(rounded-2xl)·**한 장 시트** 정합.
 * 2026-08-11 랜딩이 카드 그리드에서 단일 패널 목록으로 바뀌어 스켈레톤도 같이 옮겼다
 * (스켈레톤이 옛 모양이면 로딩→본문에서 레이아웃이 통째로 튄다).
 */
export default function EcsLandingLoading() {
  return (
    <div className="space-y-4">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-56 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-72 animate-pulse rounded" />
      </div>
      <div className="bg-card shadow-card h-[52px] animate-pulse rounded-2xl" />
      <div className="bg-card shadow-card rounded-2xl px-3 py-2.5">
        <div className="border-line border-b px-1 pb-2">
          <div className="bg-bg-soft h-4 w-64 animate-pulse rounded" />
        </div>
        <div className="grid grid-cols-1 gap-x-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="border-line-faint flex items-center gap-2 border-b px-1.5 py-[7px]">
              <div className="bg-bg-soft h-4 flex-1 animate-pulse rounded" />
              <div className="bg-bg-soft h-4 w-11 shrink-0 animate-pulse rounded" />
              <div className="bg-bg-soft h-1.5 w-10 shrink-0 animate-pulse rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
