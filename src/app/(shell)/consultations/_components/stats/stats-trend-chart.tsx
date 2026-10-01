"use client";

import dynamic from "next/dynamic";
import type { MetricSeries, StatsMetric } from "@/features/consultations/stats-model";

// recharts(~수백KB)는 그래프가 보일 때만 클라에서 로드(B5 · ssr:false는 클라 래퍼에서만 — Next 16).
const Impl = dynamic(() => import("./stats-trend-chart-impl").then((m) => m.StatsTrendChartImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-full animate-pulse rounded-lg" />,
});

/**
 * 그래프 자리 = 카드 안 **남는 높이 전부**(최소 180px) — 통계 격자에서 옆 카드(지표 줄)가 더 길면 카드가 그 높이로 늘어나는데,
 * 그래프가 180px에 멈추면 아래가 통째로 빈다(design-conventions '늘어나는 카드 안의 바닥 요소'). 늘어난 높이는 flex가 정하므로
 * 퍼센트 높이로는 못 받는다 — 바깥 상자(`relative flex-1`)가 높이를 갖고 그래프는 `absolute inset-0`으로 그 상자를 채운다.
 */
export function StatsTrendChart(props: { series: MetricSeries; metric: StatsMetric }) {
  return (
    <div className="relative min-h-[180px] flex-1">
      <div className="absolute inset-0">
        <Impl {...props} />
      </div>
    </div>
  );
}
