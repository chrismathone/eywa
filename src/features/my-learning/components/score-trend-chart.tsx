"use client";

import dynamic from "next/dynamic";
import type { Session } from "../history";

// recharts(~수백KB)는 차트가 보일 때만 클라에서 로드(ssr:false) — 첫 페인트 블로킹 제거.
const Impl = dynamic(() => import("./score-trend-chart-impl").then((m) => m.ScoreTrendChart), {
  ssr: false,
  loading: () => (
    <div className="bg-card border-line shadow-card h-[320px] animate-pulse rounded-2xl border" />
  ),
});

export function ScoreTrendChart(props: { history: Session[]; subjects: string[] }) {
  return <Impl {...props} />;
}
