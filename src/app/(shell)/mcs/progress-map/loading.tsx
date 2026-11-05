import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarRow, ToolbarSkeletonItem } from "@/components/toolbar";
import { Legend } from "@/features/math-progress-map/components/legend";
import map from "@/features/math-progress-map/components/progress-map.module.css";
import timeline from "@/features/math-progress-map/components/timeline/timeline.module.css";

/**
 * 진도맵(시안) 스켈레톤(B7) — 실물 math-progress-dashboard.tsx와 같은 배치:
 * 학생 줄 → 툴바(연도 · 보기 · 기간/종강/기준일) → **[원형 지도 | 커리큘럼 타임라인(최소 34rem)]** → **[계획 대비 실제 | 입학부터 종강까지]** 2단.
 * 지도 칸은 실물과 같은 CSS 모듈 클래스(`surface`·`mapFrame`)와 기본 표시('단계별 지도' — map-state.tsx `display = "drill"`)의 머리를 그린다.
 * 🔴 타임라인 카드 높이: 실물은 ≥1024px에서 JS로 **지도 칸의 실제 높이**에 맞춘다(curriculum-timeline-card.tsx `desktopHeight`) →
 *    스켈레톤은 CSS 기본 높이(`min(907px, …)`)를 쓰지 않고 lg에서 높이를 풀어 격자 행 stretch로 지도 칸 높이를 따라간다
 *    (안 내용은 절대 위치라 행 높이를 밀지 않는다). 1024px 미만은 실물도 CSS 기본 높이라 그대로 둔다.
 * 부모(`/mcs/loading.tsx`)는 반 목록 카드라 모양이 달라 따로 둔다. 카드 본문(타임라인 월 줄·위치 막대)은 데이터라 근사.
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";

export default function ProgressMapLoading() {
  return (
    <div className="flex flex-col gap-4">
      {/* 실물은 머리글을 compact-chrome:hidden 래퍼로 감싼다. */}
      <PageHeaderSkeleton hideCompact />
      {/* aria-hidden — 투명 글자·정적 범례를 스크린리더가 읽지 않게(머리글 스켈레톤의 실제 토글 버튼은 이 밖). */}
      <div aria-hidden className="flex flex-col gap-4">
        {/* 학생 줄 — student-header.tsx와 같은 카드(이름 text-xl + 학년 줄). */}
        <section className="bg-card shadow-card flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-4 py-3">
          <div className="min-w-0">
            <p className="text-xl leading-tight font-bold"><span className={bar}>학생 이름</span></p>
            <p className="text-xs font-medium"><span className={bar}>학년 · 과목 · 학기</span></p>
          </div>
          <span className="text-sm font-bold"><span className={bar}>교재 · 단원 · 쪽수 자리</span></span>
          <span className="ml-auto text-sm"><span className={bar}>계획 대비 · 상태</span></span>
        </section>
        {/* 툴바 — period-selector.tsx와 같은 `<Toolbar rail={false}>` + 줄 래퍼 셋: 연도 · 보기 단위 · (주차·날짜 · '종강 날짜로' 칩 · 'yyyy.mm.dd 기준'). */}
        <Toolbar rail={false}>
          <ToolbarRow>
            <ToolbarSkeletonItem className="w-44" />
          </ToolbarRow>
          <ToolbarRow>
            <ToolbarSkeletonItem className="w-72" />
          </ToolbarRow>
          <ToolbarRow>
            <ToolbarSkeletonItem className="w-56" />
            <ToolbarSkeletonItem className="w-24" />
            <span className="ml-auto inline-flex items-center gap-2 text-xs whitespace-nowrap">
              <span className={bar}>0000.00.00 기준</span>
            </span>
          </ToolbarRow>
        </Toolbar>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(34rem,1fr)] lg:items-stretch">
          {/* 원형 지도 — 같은 면(`surface`) · drill-navigation.tsx 머리(경로 '0000년' · 지도 표시 세그먼트 3칸 · 범례 3열) ·
              같은 틀(`mapFrame` = 데스크톱 80%) · 지도 아래 '우클릭하면 이전 링으로…' 안내 줄. 범례는 정적이라 실물 부품 그대로. */}
          <div className={`${map.surface} min-w-0`}>
            <div className="mb-3 flex flex-wrap items-start gap-x-4 gap-y-2">
              <div className="flex flex-[1_1_15rem] flex-wrap items-center justify-center gap-x-4 gap-y-2">
                <span className="rounded-md px-1.5 py-1 text-xs font-bold">
                  <span className={bar}>0000년</span>
                </span>
                <ToolbarSkeletonItem className="w-75" />
              </div>
              <Legend compact />
            </div>
            <div className="overflow-x-auto px-1 py-1">
              <div className={`${map.mapFrame} bg-bg-soft mx-auto aspect-square min-w-[360px] animate-pulse rounded-full`} />
            </div>
            <p className="mt-1 text-center text-xs">
              <span className={bar}>우클릭하면 이전 링으로 돌아갑니다</span>
            </p>
          </div>
          {/* 커리큘럼 타임라인 — 같은 카드(`timelineCard`) + 머리 + 월 줄. lg에서 높이를 풀고(`!` = 모듈 CSS가 레이어 밖이라) 행을 따라간다. */}
          <section className={`${timeline.timelineCard} relative lg:h-auto! lg:self-stretch!`}>
            <div className="flex min-h-0 flex-1 flex-col lg:absolute lg:inset-0">
              <header className={timeline.timelineCardHeader}>
                <div>
                  <h2><span className={bar}>0000년 진도 현황</span></h2>
                  <p><span className={bar}>오른쪽 영역만 스크롤해 월별 진도를 확인하세요.</span></p>
                </div>
                <span><span className="text-transparent">연간</span></span>
              </header>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-4 py-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="bg-bg-soft h-14 shrink-0 animate-pulse rounded-xl" />
                ))}
              </div>
            </div>
          </section>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
          {/* 계획 대비 실제 — plan-vs-actual.tsx 순서: 제목 줄 → 계획/실제 두 칸 → 막대 → 쪽 라벨 → 계획 줄. */}
          <section className="bg-card shadow-card rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-base font-bold"><span className={bar}>계획 대비 실제</span></h3>
              <span className="text-lg font-bold"><span className={bar}>상태</span></span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {["계획 위치", "실제 위치"].map((t) => (
                <div key={t} className="border-line-faint rounded-xl border px-3 py-2">
                  <p className="text-xs font-medium"><span className={bar}>{t}</span></p>
                  <p className="mt-0.5 text-sm font-bold"><span className={bar}>단원 이름 자리</span></p>
                  <p className="text-xs"><span className={bar}>p.000</span></p>
                </div>
              ))}
            </div>
            <div className="bg-bg-soft relative mt-4 h-3 animate-pulse rounded-full" />
            <div className="mt-1 flex justify-between text-xs">
              <span className={bar}>p.0</span>
              <span className={bar}>교재 이름</span>
              <span className={bar}>p.000</span>
            </div>
            <p className="mt-2 text-xs"><span className={bar}>계획 00/00 → 00/00 · 하루 0쪽 기준</span></p>
          </section>
          {/* 입학부터 종강까지 — curriculum-position.tsx 카드(제목 줄 + 위치 막대). 본문은 근사. */}
          <section className="bg-card shadow-card min-w-0 rounded-2xl p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="text-base font-bold"><span className={bar}>입학부터 종강까지</span></h3>
              <p className="text-sm font-bold"><span className={bar}>0000.00 → 0000.00</span></p>
            </div>
            <div className="bg-bg-soft mt-3 h-3 animate-pulse rounded-full" />
            <div className="bg-bg-soft mt-3 h-16 animate-pulse rounded-lg" />
          </section>
        </div>
      </div>
    </div>
  );
}
