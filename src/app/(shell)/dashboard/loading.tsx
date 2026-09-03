// '오늘' 초기 로드 스트리밍 — 지표·스케줄·카드 병렬 조회가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 체감, B7).
// 필터 searchParam 거의 없음 → 스켈레톤 플래시 트레이드오프 작음(students/billing 등과 다름).
// 모양은 실제 1차 화면(인사·지표 / 오늘 브리핑 / 접힌 줄 / 지금 진행 중)과 같은 리듬 — 2차 구역은 접힌 줄 하나 높이다.
export default function TodayLoading() {
  return (
    <div className="space-y-5 pb-4">
      {/* 인사 + KPI 4장 */}
      <div className="space-y-5">
        <div className="bg-bg-soft h-12 w-72 animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
        </div>
      </div>
      {/* 오늘 브리핑 */}
      <div className="bg-card shadow-card h-56 animate-pulse rounded-2xl" />
      {/* 접힌 2차 줄(매니저 팀 보고) */}
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-64 animate-pulse rounded-md" />
      </div>
      {/* 지금 진행 중 — 일정 + 후속조치 */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.55fr)]">
        <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
        <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
      </div>
      {/* 접힌 2차 줄 셋(비서·최근 추세·운영 맥락) */}
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-56 animate-pulse rounded-md" />
      </div>
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-40 animate-pulse rounded-md" />
      </div>
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-72 animate-pulse rounded-md" />
      </div>
    </div>
  );
}
