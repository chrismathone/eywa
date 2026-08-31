/**
 * MCS 월간 뷰 스켈레톤(B7) — 툴바 1줄 + 학생 × 수업일 표.
 * 실표면과 같은 라운드·간격이라 데이터가 도착해도 화면이 튀지 않는다(ECS 월간 loading과 같은 규약).
 */
export default function McsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-80 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-56 animate-pulse rounded" />
      </div>
      <div className="bg-card shadow-card h-[38px] shrink-0 animate-pulse rounded-lg" />
      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="bg-card shadow-card h-[74px] shrink-0 animate-pulse rounded-[10px]" />
        ))}
      </div>
    </div>
  );
}
