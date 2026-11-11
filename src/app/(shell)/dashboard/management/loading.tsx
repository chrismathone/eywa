import { PageHeaderSkeleton } from "@/components/page-header";
import { Toolbar } from "@/components/toolbar";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { SkeletonLine } from "@/components/skeleton-text";

/**
 * 경영 분석 첫 로드 뼈대 — 실물(features/management/workspace.tsx)과 같은 순서:
 * 머리글 → 툴바(뒤로 링크 · 월 이동) → 영역 이동 줄 → 지표 판.
 * 뒤로 링크(BackLink)는 창(iframe) 안에선 안 그린다(back-link.tsx) — 같은 판정을 창 마커(.embed-main) CSS로.
 * 부모 화면의 스켈레톤을 물려받지 않게 자기 것(skeleton-pairs 가드 ②).
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="경영 분석 불러오는 중">
      <PageHeaderSkeleton />
      <Toolbar>
        <SkeletonLine className="w-24 text-sm [.embed-main_&]:hidden" />
        <PeriodNavSkeleton />
      </Toolbar>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
      <div className="bg-card shadow-card h-48 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
