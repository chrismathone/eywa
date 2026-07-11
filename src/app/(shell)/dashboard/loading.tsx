// 대시보드 초기 로드 스트리밍 — 지표·스케줄·카드 15-way Promise.all이 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 체감, B7).
// 필터 searchParam 거의 없음 → 스켈레톤 플래시 트레이드오프 작음(students/billing 등과 다름).
export default function DashboardLoading() {
  return (
    <div className="space-y-4">
      {/* 커맨드 밴드 */}
      <div className="bg-card border-line shadow-card h-24 animate-pulse rounded-lg border" />
      {/* 빠른 작업 */}
      <div className="bg-card border-line shadow-card h-12 animate-pulse rounded-lg border" />
      {/* 오늘 조치 */}
      <div className="bg-card border-line shadow-card h-14 animate-pulse rounded-lg border" />
      {/* 3열 콕핏 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="bg-card border-line shadow-card min-h-[260px] animate-pulse rounded-lg border" />
        <div className="flex flex-col gap-4">
          <div className="bg-card border-line shadow-card h-36 animate-pulse rounded-lg border" />
          <div className="bg-card border-line shadow-card h-36 animate-pulse rounded-lg border" />
          <div className="bg-card border-line shadow-card h-28 animate-pulse rounded-lg border" />
        </div>
        <div className="flex flex-col gap-4">
          <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-lg border" />
          <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-lg border" />
        </div>
      </div>
      {/* 7일 추세 */}
      <div className="bg-card border-line shadow-card h-20 animate-pulse rounded-lg border" />
    </div>
  );
}
