import { PageHeaderSkeleton } from "@/components/page-header";
import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { CONTROL_H } from "@/components/ui/control-scale";
import { SkeletonLine } from "@/components/skeleton-text";

/** 조직·OKR 첫 로드 뼈대 — 기록 조회를 기다리는 동안 빈 화면 대신(B7). 실물 순서: 머리글(동작 '업무 작성센터') → 숫자 카드 4 → 보기 전환(끝에 담당자·기준일) → 목표 판. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="조직·OKR 불러오는 중">
      <PageHeaderSkeleton actions={<div className={`bg-bg-soft ${CONTROL_H} w-40 animate-pulse rounded-lg`} />} />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <BigStatSkeleton key={i} sub />)}
      </div>
      <Toolbar>
        <ToolbarSkeletonItem className="w-96 max-w-full" />
        <ToolbarSkeletonItem className="w-24" />
        <span className="ml-auto" aria-hidden><SkeletonLine className="w-40 text-sm" /></span>
      </Toolbar>
      <div className="bg-card shadow-card h-64 animate-pulse rounded-2xl" aria-hidden />
    </div>
  );
}
