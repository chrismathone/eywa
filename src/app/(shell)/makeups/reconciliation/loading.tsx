import { PageHeaderSkeleton } from "@/components/page-header";
import { SkeletonLine, SkeletonText } from "@/components/skeleton-text";
import { MakeupBackLinkSkeleton, MakeupPagerSkeleton } from "../_components/makeup-skeleton";

/** 실물 카드 표면(reconciliation-run · reconciliation-panel). */
const CARD = "border-line space-y-3 rounded-lg border p-4";

/**
 * 대사·복구 스켈레톤 — 실 배치(page.tsx): 헤더(목록) → 대사 실행 상태 카드 → 건수 문장 → 대사·기록 반영 카드 → 쪽 이동 두 줄.
 * 필터 줄·표가 없는 화면이다(항목이 카드 안에 `border-t`로 쌓인다). 항목 수·사유 입력은 데이터에 따라 달라 셋으로 그린다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="대사·복구 불러오는 중" className="space-y-4 pb-6">
      <p className="sr-only">대사 항목을 불러오고 있습니다…</p>
      <PageHeaderSkeleton actions={<MakeupBackLinkSkeleton />} />
      {/* 대사 실행 상태 — 제목(font-bold) + 최근 실행·결과·검사 3칸(sm:grid-cols-3, dt·dd 본문 한 줄씩) + '다시 대사' 접힘 줄(`min-h-6`). */}
      <section aria-hidden className={CARD}>
        <SkeletonLine className="w-28 font-bold" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <SkeletonLine className="w-16" />
              <SkeletonLine className="w-32" />
            </div>
          ))}
        </div>
        <SkeletonLine className="w-36 font-medium" />
      </section>
      <SkeletonText className="">미처리 대사 0건 · 기록 반영 대기 0건 · 반영 실패 0건</SkeletonText>
      {/* 대사·기록 반영 — 제목 + 안내(`text-sm`) + 항목(border-t pt-3: 종류 줄 · 요약 `text-sm` · 처리 버튼). */}
      <section aria-hidden className={CARD}>
        <SkeletonLine className="w-28 font-bold" />
        <SkeletonText className="text-sm">시수·출결·보고서 차이를 확인한 뒤 처리합니다. 미처리 항목이 남으면 종결할 수 없습니다.</SkeletonText>
        {[0, 1, 2].map((i) => (
          <div key={i} className="border-line space-y-2 border-t pt-3">
            <SkeletonLine className="w-48" />
            <SkeletonLine className="w-full max-w-lg text-sm" />
            <div className="bg-bg-soft h-(--control-h) w-24 animate-pulse rounded-lg" />
          </div>
        ))}
      </section>
      <MakeupPagerSkeleton />
      <MakeupPagerSkeleton />
    </div>
  );
}
