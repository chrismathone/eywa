"use client";

import dynamic from "next/dynamic";
import type { TrendChartProps } from "./trend-chart-impl";

// recharts(~수백KB)는 그래프가 보일 때만 클라에서 로드(B5 · ssr:false는 클라 래퍼에서만 — Next 16). 자리 높이 = 실그래프.
const Impl = dynamic(() => import("./trend-chart-impl").then((m) => m.TrendChartImpl), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[300px] animate-pulse rounded-lg" />,
});

export type { ChartSeries, TrendChartProps } from "./trend-chart-impl";

/** 원생 통계 그래프 — 꺾은선·막대 · 선 끝 라벨 · 마우스 오버 값 상자(일반 차트처럼). */
export function TrendChart(props: TrendChartProps) {
  return <Impl {...props} />;
}
