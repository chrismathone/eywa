// 시간표 초기 로드 스트리밍 — 무거운 getWeeklyScheduleWithStudents(전 슬롯·학생·교재·진도)가 도는
// 동안 Next가 이 loading을 Suspense fallback으로 즉시 스트리밍한다(특히 창=iframe으로 열 때 첫 페인트가
// 빈 화면이 아니라 스켈레톤). 툴바가 데이터(과목칩·인원)에 의존해 부분 페인트가 안 되므로 셸 전체 스켈레톤.
export default function TimetableLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 툴바 스켈레톤 — ⚠️ 실제 툴바(주 이동·과목칩·뷰토글·미사용요일·색·인원요약·편집·시트/엑셀 4버튼)는
          기본 창 폭(1040px)에서 **두 줄로 감싸진다**. 한 줄짜리 스켈레톤을 쓰면 데이터가 도착하는 순간
          툴바가 늘어나며 그리드가 아래로 밀려 매번 눈에 띄는 레이아웃 점프가 생겼다(창=iframe이라 자주
          열린다). 두 줄 + 실제와 같은 rounded-xl로 높이를 맞춘다(적대 감사 UX). */}
      <div className="bg-card border-line shadow-card flex shrink-0 flex-wrap items-center gap-3 rounded-xl border px-4 py-3">
        <div className="bg-bg-soft h-6 w-36 animate-pulse rounded" />
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="bg-bg-soft h-6 w-44 animate-pulse rounded" />
        <span className="bg-line h-4 w-px" aria-hidden />
        <div className="bg-bg-soft h-6 w-28 animate-pulse rounded" />
        <div className="bg-bg-soft ml-auto h-4 w-32 animate-pulse rounded" />
        {/* 둘째 줄(액션 버튼군) — w-full로 강제 줄바꿈해 실제 wrap된 높이를 재현 */}
        <div className="flex w-full items-center gap-2">
          <div className="bg-bg-soft h-6 w-20 animate-pulse rounded" />
          <div className="bg-bg-soft h-6 w-24 animate-pulse rounded" />
          <div className="bg-bg-soft h-6 w-24 animate-pulse rounded" />
          <div className="bg-bg-soft h-6 w-20 animate-pulse rounded" />
        </div>
      </div>
      {/* 그리드 스켈레톤 — 실제 그리드 카드와 같은 라운드(rounded-xl)로 전환 시 형태가 안 바뀌게 */}
      <div className="bg-card border-line shadow-card min-h-0 flex-1 animate-pulse rounded-xl border" />
    </div>
  );
}
