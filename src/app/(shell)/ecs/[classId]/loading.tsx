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
      <div className="bg-card shadow-card h-[46px] shrink-0 animate-pulse rounded-2xl" />
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
