import { StatsPanelSkeleton } from "../_components/stats/stats-skeleton";

/** 통계 화면 틀 — 설정·상담사 목록을 기다리는 동안 같은 머리 높이(컨트롤 한 줄)와 같은 격자의 빈 표면을 먼저 세운다(B7). */
export default function ConsultationStatsLoading() {
  return (
    <div className="@container/panel space-y-5 compact-chrome:space-y-3">
      <div aria-hidden="true" className="px-1">
        <div className="bg-bg-soft/40 h-(--control-h) w-1/2 max-w-md animate-pulse rounded-lg" />
      </div>
      <StatsPanelSkeleton />
    </div>
  );
}
