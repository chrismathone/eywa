import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 진도맵 스켈레톤(B7) — 학생 줄 · 툴바 · [원형 지도 | 요약 카드] · 상세. 실표면과 같은 배치라 도착해도 안 튄다.
 * 부모(`/mcs/loading.tsx`)는 반 카드 격자라 모양이 달라 따로 둔다.
 */
export default function ProgressMapLoading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeaderSkeleton hideCompact />
      <div className="bg-bg-soft h-16 animate-pulse rounded-2xl" />
      <div className="flex items-center gap-2">
        <div className="bg-bg-soft h-(--control-h) w-72 animate-pulse rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="order-2 lg:order-1">
          <div className="bg-bg-soft mx-auto aspect-square w-full max-w-[760px] animate-pulse rounded-full" />
        </div>
        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <div className="bg-bg-soft h-64 animate-pulse rounded-2xl" />
          <div className="bg-bg-soft h-44 animate-pulse rounded-2xl" />
          <div className="bg-bg-soft h-36 animate-pulse rounded-2xl" />
        </div>
      </div>
      <div className="bg-bg-soft h-56 animate-pulse rounded-2xl" />
    </div>
  );
}
