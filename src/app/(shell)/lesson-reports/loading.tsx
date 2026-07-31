// 수업보고서 초기 로드 스트리밍 — 큐·작성률·필터·목록 4쿼리(Promise.all)가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 빈 화면 방지, B7).
export default function LessonReportsLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      {/* PageHeader 근사 스켈레톤 — 실제 헤더처럼 [.embed-main_&] CSS 변형으로 창=컴팩트 1줄 /
          최상위=풀 3줄을 가른다(높이 불일치 = 로드 완료 시 본문 점프, 적대 리뷰). loading.tsx는
          요청 컨텍스트를 못 읽지만 마커는 지속 layout <main> 클래스라 CSS만으로 정합. */}
      <header className="px-1">
        <div className="bg-bg-soft h-3 w-20 animate-pulse rounded compact-chrome:hidden" />
        <div className="bg-bg-soft mt-2 h-6 w-56 animate-pulse rounded compact-chrome:hidden" />
        <div className="bg-bg-soft mt-2 h-4 w-full max-w-xl animate-pulse rounded compact-chrome:mt-0" />
      </header>
      <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-2xl border" />
      <div className="bg-card border-line shadow-card h-52 animate-pulse rounded-2xl border" />
      <div className="bg-card border-line shadow-card h-72 animate-pulse rounded-2xl border" />
    </div>
  );
}
