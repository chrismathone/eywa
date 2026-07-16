// '오늘' 초기 로드 스트리밍 — 지표·스케줄·카드 병렬 조회가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 체감, B7).
// 필터 searchParam 거의 없음 → 스켈레톤 플래시 트레이드오프 작음(students/billing 등과 다름).
export default function TodayLoading() {
  return (
    <div className="space-y-4">
      {/* EYWA 운영실 헤더 */}
      <div className="bg-card border-line shadow-card h-28 animate-pulse rounded-2xl border" />
      {/* 오늘 브리핑 */}
      <div className="bg-card border-line shadow-card h-56 animate-pulse rounded-2xl border" />
      {/* 빠른 작업 */}
      <div className="bg-card border-line shadow-card h-11 animate-pulse rounded-lg border" />
      {/* 최근 7일 추세 */}
      <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-2xl border" />
      {/* 실제 카드와 같은 md 2열 / xl 3열 다단 리듬 */}
      <div className="columns-1 gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
        <div className="bg-card border-line shadow-card h-[260px] animate-pulse rounded-lg border" />
        <div className="bg-card border-line shadow-card h-36 animate-pulse rounded-lg border" />
        <div className="bg-card border-line shadow-card h-36 animate-pulse rounded-lg border" />
        <div className="bg-card border-line shadow-card h-28 animate-pulse rounded-lg border" />
        <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-lg border" />
        <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-lg border" />
      </div>
    </div>
  );
}
