// 시간표 초기 로드 스트리밍 — 무거운 getWeeklyScheduleWithStudents(전 슬롯·학생·교재·진도)가 도는
// 동안 Next가 이 loading을 Suspense fallback으로 즉시 스트리밍한다(특히 창=iframe으로 열 때 첫 페인트가
// 빈 화면이 아니라 스켈레톤). 툴바가 데이터(과목칩·인원)에 의존해 부분 페인트가 안 되므로 셸 전체 스켈레톤.
export default function TimetableLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4 compact-chrome:gap-3">
      {/* PageHeader 근사 스켈레톤 — 창(임베드)은 헤더 줄을 통째로 접으므로(집계=툴바 우측) 스켈레톤도
          통째 숨김, 최상위 프레임만 풀 3줄(스켈레톤↔실렌더 높이 정합). */}
      <header className="shrink-0 px-1 compact-chrome:hidden">
        <div className="bg-bg-soft h-3 w-16 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-32 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-48 animate-pulse rounded" />
      </header>
      {/* 툴바 스켈레톤 — ⚠️ 실제 툴바(주 이동·과목칩·뷰토글·미사용요일·색·인원요약·편집·시트/엑셀 4버튼)는
          기본 창 폭(1040px)에서 **두 줄로 감싸진다**. 한 줄짜리 스켈레톤을 쓰면 데이터가 도착하는 순간
          툴바가 늘어나며 그리드가 아래로 밀려 매번 눈에 띄는 레이아웃 점프가 생겼다(창=iframe이라 자주
          열린다). 두 줄 + 실제와 같은 rounded-xl로 높이를 맞춘다(적대 감사 UX). */}
      {/* ⚠️ 좁은 화면(compact-chrome)에선 실제 툴바가 `.toolbar-rail`이라 **한 줄**이다 — 여기서 둘째 줄을
          그대로 두면 데이터 도착 시 툴바가 줄어들며 그리드가 위로 튀어(위 주석의 점프가 방향만 반대로) 난다.
          그래서 레일 조건에서는 둘째 줄을 접고 여백·높이도 실제와 같게 맞춘다(2026-07-30). */}
      {/* ⚠️ 실제 툴바는 카드 껍데기가 없다(툴바 규약) — 껍데기를 그리면 로딩→본문에서 카드가
          사라지며 화면이 튄다(스켈레톤=실표면 동일 캐논). 여백·높이도 실제와 같은 px-1 py-1 · h-8. */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-1 py-1 compact-chrome:flex-nowrap compact-chrome:gap-2 compact-chrome:overflow-hidden compact-chrome:px-0.5 compact-chrome:py-0.5">
        <div className="bg-bg-soft h-8 w-36 shrink-0 animate-pulse rounded-lg" />
        <span className="bg-line h-4 w-px shrink-0" aria-hidden />
        <div className="bg-bg-soft h-8 w-44 shrink-0 animate-pulse rounded-lg" />
        <span className="bg-line h-4 w-px shrink-0" aria-hidden />
        <div className="bg-bg-soft h-8 w-28 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft ml-auto h-4 w-32 shrink-0 animate-pulse rounded compact-chrome:hidden" />
        {/* 둘째 줄(액션 버튼군) — w-full로 강제 줄바꿈해 실제 wrap된 높이를 재현(데스크톱·창 전용) */}
        <div className="flex w-full items-center gap-2 compact-chrome:hidden">
          <div className="bg-bg-soft h-8 w-20 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-8 w-24 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-8 w-24 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-8 w-20 animate-pulse rounded-lg" />
        </div>
      </div>
      {/* 그리드 스켈레톤 — 실제 그리드 카드와 같은 라운드(rounded-xl)로 전환 시 형태가 안 바뀌게 */}
      <div className="bg-card border-line shadow-card min-h-0 flex-1 animate-pulse rounded-2xl border" />
    </div>
  );
}
