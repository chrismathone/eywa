// 수업보고서 초기 로드 스트리밍 — 큐·작성률·필터·목록 4쿼리(Promise.all)가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 빈 화면 방지, B7).
export default function LessonReportsLoading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <header className="border-border border-b pb-5">
        <div className="bg-bg-soft h-3 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-8 w-56 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-full max-w-xl animate-pulse rounded" />
      </header>
      <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-lg border" />
      <div className="bg-card border-line shadow-card h-52 animate-pulse rounded-lg border" />
      <div className="bg-card border-line shadow-card h-72 animate-pulse rounded-lg border" />
    </div>
  );
}
