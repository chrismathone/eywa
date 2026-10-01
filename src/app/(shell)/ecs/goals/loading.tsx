import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 반 계획 보기 스켈레톤(B7) — 실화면과 같은 골격(머리 · 툴바 · 통계 4칸 · 표)이라 로딩→본문에서 안 튄다.
 */
export default function EcsGoalsLoading() {
  return (
    <div className="space-y-4">
      <PageHeaderSkeleton />
      <div className="flex flex-wrap items-center gap-3 px-1 py-1">
        <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-60 animate-pulse rounded-lg" />
        <div className="bg-bg-soft h-(--control-h) w-40 animate-pulse rounded-lg" />
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-20 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="bg-card shadow-card space-y-2 rounded-2xl p-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="bg-bg-soft h-14 animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}
