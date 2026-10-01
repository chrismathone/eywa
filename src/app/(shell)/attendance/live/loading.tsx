import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 오늘 출결 스켈레톤 — 창(iframe)으로 열 때 빈 화면을 보이지 않게(B7).
 * 실제 표면과 같은 라운드(2xl)·간격이라 로드 후 레이아웃이 튀지 않는다.
 */
export default function Loading() {
  return (
    <div className="space-y-5">
      <PageHeaderSkeleton actions={<div className="bg-bg-soft h-(--control-h) w-64 animate-pulse rounded-lg" />} />
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-line h-40 animate-pulse rounded-2xl border" />
        ))}
      </div>
    </div>
  );
}
