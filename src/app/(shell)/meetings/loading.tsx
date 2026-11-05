import { StatStripSkeleton } from "@/components/atoms/stat-strip";
import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine } from "@/components/skeleton-text";
import { ToolbarSkeletonItem } from "@/components/toolbar";

/**
 * 회의록 목록 스켈레톤(T6, B7) — 목록 조회가 늦어도 창(iframe)이 빈 화면으로 멈춰 보이지 않게 즉시 스트리밍.
 * 구조는 page.tsx와 같게(요약 띠 3칸 → 결과·필터 줄 → 44px 행 카드) — 어긋나면 로드 끝에 화면이 튄다.
 */
export default function Loading() {
  return (
    <div className="space-y-5 compact-chrome:space-y-3" aria-busy="true" aria-label="회의록 불러오는 중">
      {/* 헤더 — 실 화면은 PageHeader를 compact-chrome:hidden 래퍼로 감싼다(데스크톱만 한 줄). */}
      <PageHeaderSkeleton hideCompact />
      {/* 요약 띠 — 전체 · AI 분석 완료 · 처리 중(보조 줄 없음). */}
      <StatStripSkeleton count={3} />
      {/* 결과 줄 + 필터 — 기간·상태 드롭다운 · 검색 토글 · 새 회의록(실물 줄 클래스 그대로). */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1">
        <SkeletonLine className="w-24 text-sm" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-12" />
          <ToolbarSkeletonItem className="w-24" />
        </div>
      </div>
      <div className="bg-card shadow-card overflow-hidden rounded-2xl">
        <div className="h-9" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="border-line flex h-11 items-center border-t px-2.5">
            <SkeletonLine className="w-1/2 text-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}
