import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 고객센터 스켈레톤 — 실제 배치(헤더 → 면 탭 → 툴바 → 표)와 같은 라운드·높이(B7).
 */
export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-4">
      <PageHeaderSkeleton />
      <div className="bg-muted h-(--control-h) w-48 animate-pulse rounded-lg" />
      <div className="flex gap-2">
        <div className="bg-muted h-(--control-h) w-28 animate-pulse rounded-lg" />
        <div className="bg-muted h-(--control-h) w-20 animate-pulse rounded-lg" />
        <div className="bg-muted ml-auto h-(--control-h) w-24 animate-pulse rounded-lg" />
      </div>
      <div className="bg-muted h-96 animate-pulse rounded-2xl" />
    </div>
  );
}
