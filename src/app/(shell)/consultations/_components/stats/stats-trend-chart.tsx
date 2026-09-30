"use client";

import dynamic from "next/dynamic";
import type { MetricSeries, StatsMetric } from "@/features/consultations/stats-model";

// recharts(~수백KB)는 그래프가 보일 때만 클라에서 로드(B5 · ssr:false는 클라 래퍼에서만 — Next 16).
const Impl = dynamic(() => import("./stats-trend-chart-impl").then((m) => m.StatsTrendChartImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[180px] animate-pulse rounded-lg" />,
});

export function StatsTrendChart(props: { series: MetricSeries; metric: StatsMetric }) {
  return <Impl {...props} />;
}
