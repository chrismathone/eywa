// 수납관리 초기 로드 스트리밍(B7) — BillingContent가 그 달 청구서 전건(2026-07 기준 385행·419KB)과
// 월 목록·학생 옵션·동기화 상태를 await하는 동안 Next가 이 loading을 Suspense fallback으로 즉시
// 스트리밍한다. 예전엔 이 라우트에 loading이 없어 **창=iframe으로 열면 응답이 올 때까지 흰 화면**이었다
// ("수납관리 창이 너무 느리다"의 체감 대부분이 이 구간).
//
// ⚠️ 실제 렌더와 블록 순서·높이를 맞춘다(동기화 배지 → 면탭 → 헤더 → 툴바 → KPI 5 → 진행률 → 표).
//    어긋나면 데이터 도착 순간 레이아웃이 튀어 스켈레톤이 없느니만 못하다(시간표 loading의 교훈).
//    간격도 실제와 같이 중첩한다 — 바깥 space-y-4(page.tsx) 안에 BillingContent의 space-y-5.
export default function BillingLoading() {
  return (
    <div className="space-y-4">
      {/* 동기화 배지 줄 */}
      <div className="bg-bg-soft h-6 w-56 animate-pulse rounded-pill" />
      {/* 면 탭 — 실제 `FaceTabs`는 **테두리 상자 하나**(`h-(--control-h) rounded-lg border`) 안에 항목이 든 모양이다.
          옛 스켈레톤은 알약 7개를 따로 그려(32px) 로딩→본문에서 모양과 높이가 함께 바뀌었다. */}
      <div className="bg-bg-soft h-(--control-h) w-[30rem] max-w-full animate-pulse rounded-lg" />
      <div className="space-y-5">
        {/* PageHeader — ⚠️ 컴팩트(창·모바일)에서 **통째로 숨기면 안 된다**. 수납 헤더는 embedLabel과
            actions(월 네비 size-8)를 넘기므로 compact에서도 32px 한 줄이 실제로 렌더된다(page-header.tsx).
            숨기면 데이터 도착 때 본문이 통째로 52px 밀린다(적대 리뷰). 시간표는 PageHeader 자체를
            compact-chrome:hidden 래퍼로 감싸 진짜 사라지므로 거기 스켈레톤만 보고 베끼면 틀린다. */}
        <header className="px-1 compact-chrome:flex compact-chrome:items-center compact-chrome:justify-between compact-chrome:gap-3">
          <div className="min-w-0">
            <div className="bg-bg-soft h-3 w-16 animate-pulse rounded compact-chrome:hidden" />
            <div className="bg-bg-soft mt-2 h-7 w-40 animate-pulse rounded compact-chrome:hidden" />
            <div className="bg-bg-soft mt-2 h-4 w-72 max-w-full animate-pulse rounded compact-chrome:mt-0 compact-chrome:w-56" />
          </div>
          {/* 머리 상시 버튼 둘('엑셀 내보내기' 텍스트 + '청구서 만들기' Primary) — compact에서만
              (넓은 화면은 위 3줄 옆에 붙어 높이를 안 늘린다). ⚠️ 옛 스켈레톤은 여기에 월 네비 32px 정사각 둘을
              그렸는데, 월 이동은 14단계에서 **툴바의 BillingMonthNav**로 내려갔다. */}
          <div className="hidden shrink-0 items-center gap-2 compact-chrome:flex">
            <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
            <div className="bg-bg-soft h-(--control-h-lg) w-28 animate-pulse rounded-lg" />
          </div>
        </header>
        {/* 툴바 — 실제는 `BillingMonthNav`(PeriodNav 한 상자 + `월:` 드롭다운) + 오른쪽 끝 검색 토글이다.
            ⚠️ 옛 스켈레톤은 **최근 6개월 알약 칩 줄**을 그렸는데 그 줄은 14단계에서 걷혔다(§10 칩 줄 금지) —
            스켈레톤만 남으면 데이터 도착 때 줄이 통째로 바뀌어 스켈레톤이 없느니만 못하다.
            카드 껍데기 없음 · 높이는 컨트롤과 같은 변수(`--control-h`, v5 control-scale). */}
        <div className="flex flex-wrap items-center gap-2.5 px-1 py-1">
          <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
          <div className="bg-bg-soft h-(--control-h) w-32 shrink-0 animate-pulse rounded-lg" />
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="bg-bg-soft h-(--control-h) w-16 animate-pulse rounded-lg" />
          </div>
        </div>
        {/* KPI 5종 */}
        {/* ⚠️ 실제와 같은 분기점(md 3 · xl 5) — 옛 스켈레톤은 2xl이라 1280~1535px에서 3열을 그리다가
            데이터가 오면 5열로 접혀 카드 줄이 통째로 튀었다. */}
        <section className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-card shadow-card h-[104px] animate-pulse rounded-2xl" />
          ))}
        </section>
        {/* 수납 진행률 */}
        <section className="bg-card shadow-card rounded-2xl p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
            <div className="bg-bg-soft h-3 w-48 animate-pulse rounded" />
          </div>
          <div className="bg-bg-soft h-2.5 rounded-pill" />
        </section>
        {/* 표 */}
        <div className="bg-card border-border h-[520px] animate-pulse rounded-2xl border" />
      </div>
    </div>
  );
}
