"use client";

import dynamic from "next/dynamic";

// recharts(~수백KB)는 통계 차트가 보일 때만 클라에서 로드(ssr:false).
const Impl = dynamic(() => import("./_charts-impl").then((m) => m.StatsCharts), {
  ssr: false,
  loading: () => (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="bg-bg-soft/40 h-72 animate-pulse rounded-md" />
      <div className="bg-bg-soft/40 h-72 animate-pulse rounded-md" />
    </div>
  ),
});

export function StatsCharts(props: {
  byCategory: { category: string; count: number }[];
  trend: { month: string; enrollment: number; student: number }[];
}) {
  return <Impl {...props} />;
}
