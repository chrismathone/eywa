"use client";

import dynamic from "next/dynamic";
import type { MonthStat } from "@/features/enrollment/server/stats-queries";

// recharts(~367KB)는 차트가 보일 때만 클라에서 로드(ssr:false) — 첫 페인트 블로킹 제거(B5).
const Impl = dynamic(() => import("./stats-trend-impl").then((m) => m.StatsTrendImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[300px] animate-pulse rounded-2xl" />,
});

export function StatsTrend(props: { months: MonthStat[]; prevYearMonths: MonthStat[]; year: number | null }) {
  return <Impl {...props} />;
}
