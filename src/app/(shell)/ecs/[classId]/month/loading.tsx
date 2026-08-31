/**
 * ECS 월간 뷰 스켈레톤(B7) — 툴바 1줄 + 목표 스트립 + 주 행 격자.
 * 실표면과 같은 라운드·간격이라 데이터가 도착해도 화면이 튀지 않는다(주간 시트 loading과 같은 규약).
 */
export default function EcsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-80 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-56 animate-pulse rounded" />
      </div>
      <div className="bg-card shadow-card h-[38px] shrink-0 animate-pulse rounded-lg" />
      <div className="bg-card shadow-card h-[150px] shrink-0 animate-pulse rounded-xl" />
      <div className="grid min-h-0 flex-1 gap-1.5" style={{ gridTemplateColumns: "44px repeat(3, minmax(0, 1fr))" }}>
        {Array.from({ length: 12 }, (_, i) => (
          <div
            key={i}
            className={
              i % 4 === 0
                ? ""
                : "bg-card shadow-card animate-pulse rounded-[10px]"
            }
          />
        ))}
      </div>
    </div>
  );
}
