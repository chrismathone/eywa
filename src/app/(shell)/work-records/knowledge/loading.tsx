import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";

/** 관찰·후속 조치 기록 첫 로드 뼈대 — 기록 조회를 기다리는 동안 빈 화면 대신(B7). 실물 순서: 머리글 → 뒤로 링크 → 기록 판(새 기록 유형 툴바 · 목록). */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="관찰·후속 조치 기록 불러오는 중">
      <PageHeaderSkeleton />
      <div className="px-1" aria-hidden><SkeletonLine className="w-32 text-sm" /></div>
      <Toolbar><ToolbarSkeletonItem className="w-80 max-w-full" /></Toolbar>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
