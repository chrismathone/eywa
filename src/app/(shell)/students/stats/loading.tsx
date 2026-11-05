import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SectionSkeleton } from "./_components/section-skeleton";
import { StatsWidthGate } from "./_components/stats-width-gate";

/**
 * 원생 통계 틀 — 재원생·수강 전건 집계를 기다리는 동안 같은 자리의 빈 표면을 먼저 세운다(B7).
 * 🔴 page.tsx가 카드마다 `<Suspense fallback={<SectionSkeleton …/>}>`로 **먼저 세우는 껍데기 4개와 똑같이** 그린다(같은 부품·id·높이 —
 *    page.tsx의 네 fallback이 정본). 다르면 loading → 껍데기 → 카드로 두 번 튄다. id가 같아 운영실 '상세'의 `#flow` 등도 처음부터 그 자리로 간다.
 */
export default function StudentStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      {/* '목록으로' 줄(과목 전환은 과목 관리자에게만) — 높이는 툴바 컨트롤과 같은 부품. */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <ToolbarSkeletonItem className="w-28" />
      </div>
      <StatsWidthGate>
        <SectionSkeleton id="trend" title="재원생 추이" height="h-[28rem]" />
        <SectionSkeleton id="courses" title="강좌수 추이" />
        <SectionSkeleton id="first" title="첫 수업 추이" />
        <SectionSkeleton id="flow" title="등록 · 퇴원 추이" />
      </StatsWidthGate>
    </div>
  );
}
