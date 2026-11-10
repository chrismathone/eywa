"use client";

import dynamic from "next/dynamic";
import type { ChartKinds, CheckView } from "@/features/dashboard/overview/chart-prefs";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import type { DemoRosterControl } from "@/features/demo-roster/types";
import { InstrumentsSkeleton } from "../_instruments/instruments-skeleton";

/**
 * 운영실 본문 = 새 대시보드(계기판) 하나(원장 2026-11-09 — 옛 운영실 화면과 '대시보드 전환'은 걷었다 · 수정 계획 P3-D).
 * 그림 엔진은 운영실 첫 묶음에 넣지 않는다(B5) — 받는 동안 = 운영실 Suspense fallback과 같은 뼈대라 깜빡이지 않는다.
 */
const InstrumentBoard = dynamic(() => import("../_instruments/instrument-board").then((m) => m.InstrumentBoard), {
  ssr: false,
  loading: () => <InstrumentsSkeleton />,
});

export function DashboardBoard({ initial, demoRoster, chartKinds, checkView }: {
  initial: OverviewSnapshot; demoRoster: DemoRosterControl | null; chartKinds: ChartKinds; checkView?: CheckView;
}) {
  return <InstrumentBoard initial={initial} chartKinds={chartKinds} checkView={checkView} demoRoster={demoRoster} />;
}
