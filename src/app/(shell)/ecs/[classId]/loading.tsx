import { TODAY_PLAN_W } from "@/features/class-sheets/lib/today-columns";

/** ECS 주간 시트 스켈레톤(B7) — 툴바 1줄 + 계획 패널 300px + 요일 컬럼(실표면과 **같은 상수** 폭·라운드
 *  정합 — 2026-08-17 열 다이어트에서 하드코딩 540이 실표면과 갈라져 import로 바꿨다). */
export default function EcsSheetLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 compact-chrome:hidden">
        <div className="bg-bg-soft h-4 w-20 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-6 w-72 animate-pulse rounded" />
        <div className="bg-bg-soft mt-2 h-4 w-56 animate-pulse rounded" />
      </div>
      {/* 상단 바 — 실표면은 **카드 껍데기가 없다**(`SHEET_BAR`, 원장 2026-09-01 "모든 헤더 스타일 일관성") —
          옛 스켈레톤은 `bg-card shadow-card` 띠를 그려 로딩→본문에서 카드가 사라지며 화면이 튀었다.
          높이는 컨트롤과 같은 변수(`--control-h`, v5 control-scale)라 고정 px로 적지 않는다. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-14 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-40 shrink-0 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-44 shrink-0 animate-pulse rounded-lg" />
      </div>
      <div className="flex min-h-0 flex-1 items-stretch gap-3 overflow-hidden">
        <div className="bg-card shadow-card w-[300px] shrink-0 animate-pulse rounded-2xl" />
        {[TODAY_PLAN_W, TODAY_PLAN_W, TODAY_PLAN_W].map((w, i) => (
          <div key={i} className="shrink-0 space-y-2" style={{ width: w }}>
            <div className="bg-card shadow-card h-[38px] animate-pulse rounded-2xl" />
            <div className="bg-card shadow-card h-[220px] animate-pulse rounded-2xl" />
            <div className="bg-card shadow-card h-[180px] animate-pulse rounded-2xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
