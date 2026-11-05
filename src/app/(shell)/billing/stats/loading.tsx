import { PageHeaderSkeleton } from "@/components/page-header";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SectionSkeleton } from "../../students/stats/_components/section-skeleton";

/**
 * 수납 통계 틀 — 청구 요약을 기다리는 동안 같은 자리의 빈 표면을 먼저(B7 · 수납관리 스켈레톤이 대신 뜨지 않게 이 라우트 것을 둔다).
 * 카드 = 원장 화면의 3장(청구·수납 추이 · 지난 기록 — 수업료 수납(10-21) · 지출 추이). 과목 관리자는 가운데 카드가 없다 — 흔한 쪽(원장)에 맞춘다.
 * 표면은 원생 통계와 같은 `SectionSkeleton`(실카드 `StatCard`와 같은 테두리·라운드 · **같은 id**라 운영실 '상세'의 `#expenses` 등이 먼저 그 자리로 간다).
 * 높이는 실카드 내용(머리 + 차트 300px + 표 접힘 · 수업료 카드는 연도별 표가 기본으로 펼쳐짐)에 맞춘 근사다.
 */
export default function BillingStatsLoading() {
  return (
    <div className="@container/panel space-y-4 compact-chrome:space-y-3">
      <PageHeaderSkeleton />
      {/* '목록으로' 줄(과목 전환은 과목 관리자에게만) — 높이는 툴바 컨트롤과 같은 부품. */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <ToolbarSkeletonItem className="w-28" />
      </div>
      <SectionSkeleton id="billing" title="청구 · 수납 추이" height="h-[35rem]" />
      <SectionSkeleton id="tuition-history" title="지난 기록 — 수업료 수납" height="h-[42rem]" />
      <SectionSkeleton id="expenses" title="지출 추이" height="h-[32rem]" />
    </div>
  );
}
