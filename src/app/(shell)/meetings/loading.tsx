import { PageHeaderSkeleton } from "@/components/page-header";

/**
 * 회의록 목록 스켈레톤(T6, B7) — 목록 조회가 늦어도 창(iframe)이 빈 화면으로 멈춰 보이지 않게 즉시 스트리밍.
 * 구조는 page.tsx와 같게(지표 줄 → 결과·필터 줄 → 44px 행 카드) — 어긋나면 로드 끝에 화면이 튄다.
 */
export default function Loading() {
  return (
    <div className="space-y-5 compact-chrome:space-y-3" aria-busy="true" aria-label="회의록 불러오는 중">
      {/* 헤더 — 실 화면은 PageHeader를 compact-chrome:hidden 래퍼로 감싼다(데스크톱만 한 줄). */}
      <PageHeaderSkeleton hideCompact />
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="bg-card shadow-card h-20 animate-pulse rounded-2xl" />
        ))}
      </div>
      <div className="flex items-center justify-between px-1">
        <div className="bg-bg-soft h-5 w-24 animate-pulse rounded" />
        <div className="bg-bg-soft h-(--control-h) w-72 animate-pulse rounded-lg" />
      </div>
      <div className="bg-card shadow-card overflow-hidden rounded-2xl">
        <div className="h-9" />
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="border-line flex h-11 items-center border-t px-2.5">
            <div className="bg-bg-soft h-4 w-1/2 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
