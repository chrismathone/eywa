import { PageHeaderSkeleton } from "@/components/page-header";

/** 출결 통계 틀 — 집계를 기다리는 동안 같은 자리의 빈 표면을 먼저(B7 · 출석부 스켈레톤이 대신 뜨지 않게 이 라우트 것을 둔다). */
export default function AttendanceStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="px-1">
        <div className="bg-bg-soft/40 h-(--control-h) w-28 animate-pulse rounded-lg" />
      </div>
      <div aria-hidden="true" className="bg-bg-soft/40 h-[30rem] animate-pulse rounded-2xl" />
    </div>
  );
}
