"use client";

import dynamic from "next/dynamic";
import type { ReportChartProps } from "./report-chart-impl";

// recharts(~수백KB)는 차트가 보일 때만 클라에서 로드(원생 통계 `trend-chart.tsx`와 같은 길 · ssr:false는 클라 래퍼에서만 — Next 16).
// 자리 높이 = 실그래프(CHART_HEIGHT 280) — 도착할 때 아래 블록이 튀지 않게.
const Impl = dynamic(() => import("./report-chart-impl").then((m) => m.ReportChartImpl), {
  ssr: false,
  loading: () => <div aria-hidden className="bg-bg-soft/40 h-[280px] animate-pulse rounded-lg" />,
});

/** 학원 비서 보고서 차트 — 조회 결과를 가리켜 그린다(막대·쌓은 막대·꺾은선·영역·원그래프). */
export function ReportChart(props: ReportChartProps) {
  return <Impl {...props} />;
}
