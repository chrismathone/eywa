// '오늘' 초기 로드 스트리밍 — 지표·카드 병렬 조회가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 체감, B7).
// 필터 searchParam 거의 없음 → 스켈레톤 플래시 트레이드오프 작음(students/billing 등과 다름).
//
// ⚠️ **블록 수·순서를 실제 페이지와 맞춰 둘 것** — 스켈레톤이 더 많이 그리면 로드가 끝나는 순간
// 있던 자리가 사라져 화면이 위로 튄다. 2026-09-03에 '대화형 비서'·'실시간 운영'·'빠른 작업'이
// 빠지면서 이 파일이 3열 masonry로 카드 6장을 그리고 있던 것을 실제 구조(세로 6블록)로 맞췄다.
export default function TodayLoading() {
  return (
    <div className="space-y-5 pb-4">
      {/* 운영실 헤더(인사 + 지표) */}
      <div className="bg-card border-line shadow-card h-28 animate-pulse rounded-2xl border" />
      {/* 일일 AI 브리핑 */}
      <div className="bg-card border-line shadow-card h-52 animate-pulse rounded-2xl border" />
      {/* 오늘 브리핑 */}
      <div className="bg-card border-line shadow-card h-56 animate-pulse rounded-2xl border" />
      {/* 상담 후속조치 */}
      <div className="bg-card border-line shadow-card h-24 animate-pulse rounded-2xl border" />
      {/* 학원생 증감 */}
      <div className="bg-card border-line shadow-card h-40 animate-pulse rounded-2xl border" />
      {/* 운영 맥락 — 바깥 카드 한 장 안에 미수·등록상담·공지 패널 */}
      <div className="bg-card border-line shadow-card h-80 animate-pulse rounded-2xl border" />
    </div>
  );
}
