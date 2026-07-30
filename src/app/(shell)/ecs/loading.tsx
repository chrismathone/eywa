/** ECS 랜딩 스켈레톤(B7) — 실표면과 동일 라운드(rounded-2xl)·카드 그리드 정합. */
export default function EcsLandingLoading() {
  return (
    <div className="space-y-4">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-56 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-72 animate-pulse rounded" />
      </div>
      <div className="bg-card shadow-card h-[52px] animate-pulse rounded-2xl" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="bg-card shadow-card h-[104px] animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
