export default function PublicSeatLoading() {
  // 폭은 page.tsx와 **같은 클래스** — 다르면 스켈레톤에서 본문으로 넘어갈 때 폭이 튄다.
  return (
    <div className="flex flex-col gap-3 px-3 pt-4 pb-8 lg:px-6 lg:pb-10">
      <div className="bg-bg-soft h-4 w-24 animate-pulse rounded" />
      <div className="bg-bg-soft h-6 w-40 animate-pulse rounded" />
      <div className="flex gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-7 w-20 animate-pulse rounded-full" />
        ))}
      </div>
      <div className="bg-card shadow-card h-[46px] animate-pulse rounded-2xl" />
    </div>
  );
}
