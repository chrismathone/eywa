import { ToolbarSkeletonItem } from "@/components/toolbar";
import { Bar, ContributionHeaderSkeleton } from "../_components/contribution-skeleton";

/**
 * 지난 소개 확인 스켈레톤 — 실물(`ReferralView` → `ReferralReview`)과 같은 한 열: 머리(동작 없음) → 상태 4칸 띠 → 소개 표 상자.
 * 표 상자 높이는 쪽당 15줄 기준의 근사다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="지난 소개 확인 불러오는 중" className="w-full min-w-0 space-y-5 pb-6">
      <ContributionHeaderSkeleton
        title="지난 소개 확인"
        description="과거 상담에 남은 소개자 정보를 확인합니다. 후보와 상담 원본을 대조한 뒤 학생에게 연결할 수 있습니다."
      />
      <div className="space-y-5">
        <div aria-hidden className="border-line grid grid-cols-4 overflow-hidden rounded-xl border phone:grid-cols-2">
          {["자동 연결 조건 통과", "직접 확인 필요", "소개자 정보 부족", "연결 완료"].map((label) => (
            <div key={label} className="border-line border-r px-5 py-4 last:border-r-0">
              <span className="block text-xs">
                <Bar>{label}</Bar>
              </span>
              <strong className="mt-2 block text-xl">
                <Bar>000건</Bar>
              </strong>
            </div>
          ))}
        </div>
        <section aria-hidden className="border-line overflow-hidden rounded-xl border">
          {/* 머리 줄 — 검색 칸(w-72) + 상태 선택 / 오른쪽 기준일 한 줄 */}
          <div className="border-line flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div className="flex flex-wrap gap-3">
              <ToolbarSkeletonItem className="w-72 max-w-full" />
              <ToolbarSkeletonItem className="w-40" />
            </div>
            <p className="text-xs">
              <Bar>2026-01-01까지 등록된 상담</Bar>
            </p>
          </div>
          <div className="bg-bg-soft/40 h-[48rem] animate-pulse" />
        </section>
        {/* 표 아래 안내 한 단락(실물 `ReferralReview` 끝) */}
        <p aria-hidden className="text-xs leading-relaxed">
          <Bar>자동 연결 조건을 통과해도 실제 연결 전에는 점수에 반영되지 않습니다. 마지막 확인 2026. 1. 1. 오전 0:00:00</Bar>
        </p>
      </div>
    </div>
  );
}
