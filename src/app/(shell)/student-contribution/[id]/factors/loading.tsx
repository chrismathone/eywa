import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";

/**
 * 42팩터 정밀분석 첫 로드 뼈대 — 실물(factor-workspace.tsx)과 같은 순서: 머리글 → 툴바(뒤로 · 분석 월 · 조회 · 기준일) → 요약 판 → 요인 작업대.
 * 부모 화면의 스켈레톤을 물려받지 않게 자기 것(skeleton-pairs 가드 ②).
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="로열티 정밀분석 불러오는 중">
      <PageHeaderSkeleton />
      <Toolbar>
        <SkeletonLine className="w-36 text-sm" />
        <ToolbarSkeletonItem className="w-44" />
        <ToolbarSkeletonItem className="w-16" />
        <SkeletonLine className="w-64 text-xs" />
      </Toolbar>
      <div className="bg-card shadow-card h-48 animate-pulse rounded-2xl" aria-hidden />
      <div className="bg-card shadow-card h-96 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
