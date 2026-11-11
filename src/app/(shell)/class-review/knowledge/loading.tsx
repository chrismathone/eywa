import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";

/** 강사 지식그래프 첫 로드 뼈대 — 실물(features/teacher-hub/workspace.tsx)과 같은 순서: 머리글 → 툴바(뒤로 — 창 안에선 BackLink가 안 서서 창 마커 CSS로 숨김 · 강사 · 월 · 조회) → 구역 이동 줄 → 판. */
export default function Loading() {
  return <div className="space-y-4" aria-busy="true" aria-label="강사 지식그래프 불러오는 중">
    <PageHeaderSkeleton />
    <Toolbar>
      <SkeletonLine className="w-24 text-sm [.embed-main_&]:hidden" />
      <ToolbarSkeletonItem className="w-44" />
      <ToolbarSkeletonItem className="w-52" />
      <ToolbarSkeletonItem className="w-16" />
    </Toolbar>
    <div className="bg-bg-soft h-(--control-h-sm) w-[40rem] max-w-full animate-pulse rounded-lg" aria-hidden />
    <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
    <div className="bg-card shadow-card h-48 animate-pulse rounded-2xl" aria-hidden />
  </div>;
}
