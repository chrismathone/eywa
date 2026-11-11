import { PageHeaderSkeleton } from "@/components/page-header";
import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";
import { CONTROL_H } from "@/components/ui/control-scale";

/**
 * 홍보·마케팅 통합 관리 첫 로드 뼈대 — 실물(features/marketing-archive/workspace.tsx)과 같은 순서:
 * 머리글(동작 '+ 행사·홍보 기획') → 원본 링크 한 줄 → 숫자 카드 5 → 보기 전환 툴바 → 본문 판 둘.
 * 행사·원본 자료를 한꺼번에 읽어 첫 페인트가 늦다(B7) — 그동안 이 뼈대가 선다.
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="홍보·마케팅 불러오는 중">
      <PageHeaderSkeleton actions={<div className={`bg-bg-soft ${CONTROL_H} w-40 animate-pulse rounded-lg`} />} />
      <div className="px-1" aria-hidden><SkeletonLine className="w-[36rem] max-w-full text-sm" /></div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <BigStatSkeleton key={i} />)}
      </div>
      <Toolbar>
        <ToolbarSkeletonItem className="w-[30rem] max-w-full" />
        <ToolbarSkeletonItem className="w-36" />
      </Toolbar>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]" aria-hidden>
        <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
        <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" />
      </div>
      <div className="bg-card shadow-card h-72 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
