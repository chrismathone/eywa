import { PageHeaderSkeleton } from "@/components/page-header";

export default function LoadingMakeups() {
  return <div role="status" aria-label="보강 목록 불러오는 중" className="space-y-4 p-4">
    <PageHeaderSkeleton />
    <p>보강 기록을 불러오고 있습니다…</p>
    <div className="bg-bg-soft h-24 animate-pulse rounded-lg" />
  </div>;
}
