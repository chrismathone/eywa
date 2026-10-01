import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 자리 월간 스켈레톤(B7) — 반 14개·학생 88명 조회가 첫 페인트를 막지 않게.
 */
export default function SeatMonthlyLoading() {
  return (
    <div className="flex flex-col gap-3">
      <PageHeaderSkeleton actions={<div className="bg-bg-soft h-(--control-h) w-64 animate-pulse rounded-lg" />} />
      <div className="bg-card shadow-card h-[54px] animate-pulse rounded-2xl" />
      <div className="bg-card shadow-card h-[64px] animate-pulse rounded-2xl" />
      <div className="bg-card shadow-card h-[420px] animate-pulse rounded-2xl" />
    </div>
  );
}
