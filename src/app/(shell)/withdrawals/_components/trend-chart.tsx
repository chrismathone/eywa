"use client";

import dynamic from "next/dynamic";
import type { WithdrawalMonthPoint } from "./trend-chart-impl";

export type { WithdrawalMonthPoint };

// recharts(~수백KB)는 차트가 보일 때만 클라에서 로드(ssr:false).
const Impl = dynamic(() => import("./trend-chart-impl").then((m) => m.WithdrawalTrendChart), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[200px] animate-pulse rounded-lg" />,
});

export function WithdrawalTrendChart(props: { data: WithdrawalMonthPoint[] }) {
  return <Impl {...props} />;
}
