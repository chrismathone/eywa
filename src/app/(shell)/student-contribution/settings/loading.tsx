import { ToolbarSkeletonItem } from "@/components/toolbar";
import { BlockSkeleton, Bar, ContributionHeaderSkeleton, ScoreBreakdownSkeleton } from "../_components/contribution-skeleton";

// 배점 표 두 묶음 — 실물 `METRIC_GROUPS`의 줄 수(운영 6 · 학습·참여 5). 두 상자는 격자라 높이가 같아진다.
const GROUPS = [
  { title: "운영 기여", rows: 6 },
  { title: "학습·참여", rows: 5 },
];

/**
 * 기여도 배점 설정 스켈레톤 — 실물(`ContributionSettings`)과 같은 xl 2열:
 * 왼쪽[배점 표 2묶음 → 실적 인정 기준 → 저장 줄] | 오른쪽[저장 전 미리보기 → 점수 구성 → 안내 한 단락]. 머리엔 동작이 없다.
 */
export default function Loading() {
  return (
    <div role="status" aria-label="기여도 배점 설정 불러오는 중" className="w-full min-w-0 space-y-5 pb-6">
      <ContributionHeaderSkeleton
        title="기여도 배점 설정"
        description="어떤 실적에 몇 점을 더할지 정합니다. 저장하면 과거 실적 전체에도 새 배점을 적용합니다."
      />
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,1fr)]">
        <div className="min-w-0 space-y-5">
          <div aria-hidden className="grid grid-cols-2 gap-5 phone:grid-cols-1">
            {GROUPS.map((group) => (
              <section key={group.title} className="border-line min-w-0 overflow-hidden rounded-xl border">
                <h2 className="border-line bg-primary-softer border-b px-5 py-4 font-semibold">
                  <Bar>{group.title}</Bar>
                </h2>
                <div className="divide-line divide-y">
                  {Array.from({ length: group.rows }, (_, i) => (
                    <div key={i} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 px-5 py-4">
                      <div>
                        <p className="text-sm font-medium">
                          <Bar>지표 이름</Bar>
                        </p>
                        <p className="mt-1 ml-6 text-xs">
                          <Bar>1건당</Bar>
                        </p>
                      </div>
                      <ToolbarSkeletonItem className="w-full" />
                      <span className="text-sm">
                        <Bar>점</Bar>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
          {/* 실적 인정 기준(입력 둘 + 체크 한 줄) · 저장 줄 — 고정 구성이라 상자 높이만 근사. */}
          <BlockSkeleton className="h-60" />
          <BlockSkeleton className="h-24" />
        </div>
        <aside aria-hidden className="min-w-0 space-y-4">
          <div className="bg-primary-softer h-60 animate-pulse rounded-xl border border-primary/30" />
          <ScoreBreakdownSkeleton />
          <p className="px-1 text-xs leading-relaxed">
            <Bar>모든 항목은 상한 없이 누적합니다. 수업료는 원 단위 순액을 모은 뒤 10만 원당 배점을 적용합니다. 항목을 끄면 해당 실적은 보존되고 점수에서만 빠집니다.</Bar>
          </p>
        </aside>
      </div>
    </div>
  );
}
