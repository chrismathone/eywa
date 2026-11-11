import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { SkeletonLine } from "@/components/skeleton-text";

/** 방문·등록 점검 — 상담·기록 전건을 읽는 화면이라 뼈대를 먼저 스트리밍한다(B7). 실물 순서: 머리글 → 툴바(뒤로 · 연도 이동) → 지표 4 → 그림 → 보기 전환 → 기록 판. */
export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="방문·등록 점검 불러오는 중">
      <PageHeaderSkeleton />
      <Toolbar>
        <SkeletonLine className="w-28 text-sm" />
        <PeriodNavSkeleton />
        <SkeletonLine className="w-56 text-xs" />
      </Toolbar>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((i) => <div key={i} className="bg-card shadow-card h-28 animate-pulse rounded-2xl" />)}
      </div>
      <div className="bg-card shadow-card h-56 animate-pulse rounded-2xl" aria-hidden />
      <Toolbar><ToolbarSkeletonItem className="w-96 max-w-full" /></Toolbar>
      <div className="bg-card shadow-card h-72 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
