/**
 * 자리 월간 스켈레톤(B7) — 반 14개·학생 88명 조회가 첫 페인트를 막지 않게.
 */
export default function SeatMonthlyLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-16 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-40 animate-pulse rounded" />
      </div>
      <div className="bg-card shadow-card h-[54px] animate-pulse rounded-2xl" />
      <div className="bg-card shadow-card h-[64px] animate-pulse rounded-2xl" />
      <div className="bg-card shadow-card h-[420px] animate-pulse rounded-2xl" />
    </div>
  );
}
