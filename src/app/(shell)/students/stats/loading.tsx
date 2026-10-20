import { PageHeaderSkeleton } from "@/components/page-header";

/** 원생 통계 틀 — 재원생·수강 전건 집계를 기다리는 동안 같은 자리의 빈 표면을 먼저 세운다(B7 · 라운드 = 실표면). */
export default function StudentStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="px-1">
        <div className="bg-bg-soft/40 h-(--control-h) w-28 animate-pulse rounded-lg" />
      </div>
      <div aria-hidden="true" className="bg-bg-soft/40 h-[28rem] animate-pulse rounded-2xl" />
      <div aria-hidden="true" className="bg-bg-soft/40 h-96 animate-pulse rounded-2xl" />
      <div aria-hidden="true" className="bg-bg-soft/40 h-96 animate-pulse rounded-2xl" />
    </div>
  );
}
