import { PageHeaderSkeleton } from "@/components/page-header";

/** 수납 통계 틀 — 청구 요약을 기다리는 동안 같은 자리의 빈 표면을 먼저(B7 · 수납관리 스켈레톤이 대신 뜨지 않게 이 라우트 것을 둔다). */
export default function BillingStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      <div aria-hidden="true" className="px-1">
        <div className="bg-bg-soft/40 h-(--control-h) w-28 animate-pulse rounded-lg" />
      </div>
      <div aria-hidden="true" className="bg-bg-soft/40 h-[34rem] animate-pulse rounded-2xl" />
    </div>
  );
}
