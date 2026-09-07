// '오늘' 초기 로드 스트리밍 — 지표·스케줄·카드 병렬 조회가 도는 동안
// Next가 이 loading을 Suspense fallback으로 즉시 스트리밍(창=iframe 첫 페인트 체감, B7).
// 필터 searchParam 거의 없음 → 스켈레톤 플래시 트레이드오프 작음(students/billing 등과 다름).
//
// ⚠️ **블록 수·순서를 실제 페이지와 맞춰 둘 것** — 스켈레톤이 더 많이(또는 적게) 그리면 로드가 끝나는
// 순간 화면이 튀어 없느니만 못하다. 지금 구조는 두 지시가 합쳐진 결과다:
//   · 원장 2026-09-03 — '대화형 비서'·'실시간 운영(오늘 일정)'·'빠른 작업'을 화면에서 뺐다.
//   · 디자인 v5 §4 — 1차 앵커 셋(인사·지표 / 오늘 브리핑 / 후속조치) 외엔 **접힌 2차 줄**로 내렸다.
// 그래서 카드는 셋뿐이고 나머지는 줄 하나 높이다(매니저 팀 보고 · 학원생 증감 · 운영 맥락).
export default function TodayLoading() {
  return (
    <div className="space-y-5 pb-4">
      {/* ① 인사 + KPI 4장 */}
      <div className="space-y-5">
        <div className="bg-bg-soft h-12 w-72 animate-pulse rounded-lg" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4 xl:gap-4">
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
          <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />
        </div>
      </div>
      {/* ② 오늘 브리핑 */}
      <div className="bg-card shadow-card h-56 animate-pulse rounded-2xl" />
      {/* 접힌 2차 줄 — 매니저 팀 보고(AI) */}
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-64 animate-pulse rounded-md" />
      </div>
      {/* ③ 상담 후속조치 — '실시간 운영' 묶음이 사라져 이제 홀로 한 줄을 다 쓴다 */}
      <div className="bg-card shadow-card h-40 animate-pulse rounded-2xl" />
      {/* 접힌 2차 줄 둘 — 학원생 증감 · 운영 맥락 */}
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-40 animate-pulse rounded-md" />
      </div>
      <div className="border-line border-t py-3">
        <div className="bg-bg-soft h-6 w-72 animate-pulse rounded-md" />
      </div>
    </div>
  );
}
