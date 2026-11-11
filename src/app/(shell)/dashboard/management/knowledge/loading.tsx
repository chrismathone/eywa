import { PageHeaderSkeleton } from "@/components/page-header";
import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";
import { CONTROL_H } from "@/components/ui/control-scale";

/**
 * 스키마·지식그래프 첫 로드 뼈대 — 실물(features/academy-knowledge/workspace.tsx)과 같은 순서:
 * 머리글(동작 둘) → '← 경영 분석' 링크(창 안에서도 늘 보인다 — 메뉴 직행 화면) → 숫자 카드 4 → 조회 판 → 영역 전환 툴바 → 본문 판.
 * 부모 화면의 스켈레톤을 물려받지 않게 자기 것(skeleton-pairs 가드 ②).
 */
export default function Loading() {
  const action = <div className={`bg-bg-soft ${CONTROL_H} w-52 animate-pulse rounded-lg`} />;
  return (
    <div className="space-y-5" aria-busy="true" aria-label="스키마·지식그래프 불러오는 중">
      <PageHeaderSkeleton actions={<>{action}{action}</>} />
      <div className="px-1" aria-hidden><SkeletonLine className="w-24 text-sm" /></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <BigStatSkeleton key={i} sub />)}
      </div>
      <div className="bg-card shadow-card h-28 animate-pulse rounded-2xl" aria-hidden />
      <Toolbar>
        <ToolbarSkeletonItem className="w-[46rem] max-w-full" />
      </Toolbar>
      <div className="bg-card shadow-card h-96 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
