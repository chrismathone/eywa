"use client";

import dynamic from "next/dynamic";
import type { GradeSeriesPoint } from "@/lib/calc/grades";

// recharts(~수백KB)는 성적 탭이 열려 차트가 보일 때만 클라에서 로드(ssr:false).
const Impl = dynamic(() => import("./grades-chart-impl").then((m) => m.GradesChart), {
  ssr: false,
  loading: () => <div className="bg-bg-soft/40 h-[220px] animate-pulse rounded-lg" />,
});

export function GradesChart(props: {
  series: GradeSeriesPoint[];
  subjectLabels?: Record<string, string>;
}) {
  return <Impl {...props} />;
}
