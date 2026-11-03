import { PageHeaderSkeleton } from "@/components/page-header";

/** 첫 페인트용 뼈대(B7) — 중심 전환은 `startTransition`이라 이 뼈대가 다시 뜨지 않고 옛 화면이 흐려진 채 기다린다. */
export default function Loading() {
  return (
    <div className="space-y-4" role="status" aria-label="연결 탐색 불러오는 중">
      <div className="bg-bg-soft mx-1 h-5 w-64 animate-pulse rounded" />
      <PageHeaderSkeleton />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        <div className="bg-bg-soft mx-auto aspect-square w-full max-w-2xl animate-pulse rounded-full" />
        <div className="bg-bg-soft h-[32rem] animate-pulse rounded-2xl" />
      </div>
    </div>
  );
}
