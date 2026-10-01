import { PageHeaderSkeleton } from "@/components/page-header";

// 수업보고서 초기 로드 스트리밍 — 큐·작성률·필터·목록 4쿼리(Promise.all)가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 빈 화면 방지, B7).
export default function LessonReportsLoading() {
  return (
    <div className="w-full min-w-0 space-y-6">
      {/* PageHeader 스켈레톤 — 실제 헤더처럼 compact-chrome CSS 변형으로 창=라벨 한 줄 /
          최상위=제목 한 줄을 가른다(높이 불일치 = 로드 완료 시 본문 점프, 적대 리뷰). loading.tsx는
          요청 컨텍스트를 못 읽지만 마커는 지속 layout <main> 클래스라 CSS만으로 정합. */}
      <PageHeaderSkeleton />
      {/* 면 탭 — 실화면은 헤더 바로 아래 `FaceTabs` 한 줄이다(높이는 컨트롤과 같은 변수). 빠뜨리면
          데이터 도착 때 아래 카드가 그 줄만큼 통째로 내려간다. */}
      <div className="bg-bg-soft h-(--control-h) w-72 max-w-full animate-pulse rounded-lg" />
      <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-2xl border" />
      <div className="bg-card border-line shadow-card h-52 animate-pulse rounded-2xl border" />
      <div className="bg-card border-line shadow-card h-72 animate-pulse rounded-2xl border" />
    </div>
  );
}
