/**
 * 자리 출석부 스켈레톤(B7) — 이 화면은 자리에서 창(iframe)으로 열려 곧바로 출결을 찍는 자리라,
 * 첫 페인트가 비면 "안 열렸다"로 읽힌다. 교시 레일 + 반 카드 모양만 먼저 흘려보낸다.
 */
export default function SeatAttendanceLoading() {
  return (
    <div className="flex flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-16 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-32 animate-pulse rounded" />
      </div>
      {/* 교시 레일 */}
      <div className="flex gap-1.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-7 w-24 animate-pulse rounded-full" />
        ))}
      </div>
      {/* 요약 줄 */}
      <div className="bg-card shadow-card h-[46px] animate-pulse rounded-2xl" />
      {/* 반 카드 2장 */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="border-line h-[132px] animate-pulse rounded-2xl border" />
      ))}
    </div>
  );
}
