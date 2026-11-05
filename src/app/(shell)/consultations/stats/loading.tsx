import { ToolbarSkeletonItem } from "@/components/toolbar";
import { StatsPanelSkeleton } from "../_components/stats/stats-skeleton";

/**
 * 통계 화면 틀 — 설정·상담사 목록을 기다리는 동안 같은 머리 줄과 같은 격자의 빈 표면을 먼저 세운다(B7).
 * 머리 줄 = 실물(page.tsx)과 같은 `flex-wrap` 줄에 컨트롤 6개(목록으로 · 기간 · 카테고리 · 후속 · 상담사 · 과목) — 막대 하나로 두면
 * 폰에서 실물은 2~3줄로 감기는데 스켈레톤은 한 줄이라 본문이 내려앉았다. 상담사는 강사 계정에선 안 서지만 기본 경로(사무실)로 그린다.
 */
export default function ConsultationStatsLoading() {
  return (
    <div className="@container/panel space-y-5 compact-chrome:space-y-3">
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2 px-1">
        {["w-24", "w-28", "w-32", "w-24", "w-28", "w-24"].map((w, i) => (
          <ToolbarSkeletonItem key={i} className={w} />
        ))}
      </div>
      <StatsPanelSkeleton />
    </div>
  );
}
