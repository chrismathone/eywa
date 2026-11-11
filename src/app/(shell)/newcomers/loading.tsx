import { PageHeaderSkeleton } from "@/components/page-header";
import { BigStatSkeleton } from "@/components/atoms/big-stat";
import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";
import { CONTROL_H } from "@/components/ui/control-scale";

/**
 * 신규생 관리 스켈레톤 — 실물(features/newcomers/followup-workspace.tsx '학생별 정착 관리' 첫 면)과 같은 순서:
 * 머리글(동작 '입학 약속·이행 보기') → 보기 전환 툴바(+ 단계 안내) → 요약 숫자 카드 4 → 그림 카드 줄 → 학생별 표 판.
 * 2026-11-11 디자인 통일 — 옛 신규생 보드(newcomer-board) 모양을 그리던 것을 지금 첫 화면 모양으로 바꿨다.
 * 기본 담당 띠·연동 안내·실패 띠는 상태에 따라 서므로 그리지 않는다.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="신규생 관리 불러오는 중">
      <p className="sr-only" role="status">신규생 관리 기록을 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<div className={`bg-bg-soft ${CONTROL_H} w-48 animate-pulse rounded-lg`} />} />
      <Toolbar className="mt-4 mb-3">
        <ToolbarSkeletonItem className="w-[26rem] max-w-full" />
        <span className="ml-auto" aria-hidden><SkeletonLine className="w-40 text-xs" /></span>
      </Toolbar>
      <div className="mb-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <BigStatSkeleton key={i} sub />)}
      </div>
      <div className="mb-3 grid grid-cols-3 gap-3" aria-hidden>
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="bg-card shadow-card h-56 animate-pulse rounded-2xl" />)}
      </div>
      <div className="bg-card shadow-card rounded-2xl p-4" aria-hidden>
        <Toolbar rail={false}>
          <ToolbarSkeletonItem className="w-[30rem] max-w-full" />
          <ToolbarSkeletonItem className="w-44" />
          <ToolbarSkeletonItem className="w-32" />
        </Toolbar>
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="border-line-faint flex h-11 items-center border-b px-3">
            <SkeletonLine className="w-3/4" />
          </div>
        ))}
      </div>
    </div>
  );
}
