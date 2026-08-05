/**
 * 날짜별 출결 화면 스켈레톤 — 부모(/attendance)의 표 모양 스켈레톤이 여기까지 내려오면 레이아웃이
 * 크게 튄다(이 화면은 표가 아니라 목록 카드다). 모양이 맞는 걸 따로 둔다.
 */
export default function AttendanceDateLoading() {
  return (
    <div className="space-y-5">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-44 animate-pulse rounded" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-card shadow-card h-[72px] animate-pulse rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
