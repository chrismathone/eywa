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
      {/* 툴바 스켈레톤 — 실제 툴바는 **왼쪽 묶음 / 오른쪽 묶음** 두 상자다(11·12단계): 왼쪽 = 주 이동 ·
          `축: 값` 드롭다운 넷(과목·구분·프로그램·뷰) · 검색 토글 · 설정/엑셀, 오른쪽 = 집계·ECS·편집.
          창을 줄이면 **묶음 단위로** 줄이 바뀌므로 스켈레톤도 같은 묶음이라야 데이터 도착 때 안 튄다.
          ⚠️ 카드 껍데기 없음 · 높이는 컨트롤과 같은 변수(`--control-h`) — 옛 스켈레톤은 h-8(32px) 한 줄 + 액션 4개
             둘째 줄이었는데, 그건 v5 이전 툴바(과목칩·뷰토글·색·편집 버튼 4개)의 모양이다.
          ⚠️ 좁은 화면(compact-chrome)에선 실제 툴바가 `.toolbar-rail` 한 줄이라 묶음 상자가 사라진다(display: contents). */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-1 py-1 compact-chrome:flex-nowrap compact-chrome:gap-2 compact-chrome:overflow-hidden compact-chrome:px-0.5 compact-chrome:py-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-3 compact-chrome:flex-nowrap compact-chrome:gap-2">
          <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-28 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-24 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-28 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-16 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-20 shrink-0 animate-pulse rounded-lg compact-chrome:hidden" />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-3 compact-chrome:gap-2">
          <div className="bg-bg-soft h-4 w-28 animate-pulse rounded compact-chrome:hidden" />
          <div className="bg-bg-soft h-(--control-h) w-20 shrink-0 animate-pulse rounded-lg" />
        </div>
      </div>
      {/* 그리드 스켈레톤 — 실제 그리드 카드와 같은 라운드(rounded-xl)로 전환 시 형태가 안 바뀌게 */}
      <div className="bg-card border-line shadow-card min-h-0 flex-1 animate-pulse rounded-2xl border" />
    </div>
  );
}
