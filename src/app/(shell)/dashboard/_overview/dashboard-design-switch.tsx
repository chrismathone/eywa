"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { ChartKinds, CheckView } from "@/features/dashboard/overview/chart-prefs";
import { saveDashboardDesign } from "@/features/dashboard/overview/chart-prefs-actions";
import type { DashboardDesign } from "@/features/dashboard/overview/chart-prefs";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import type { DemoRosterControl } from "@/features/demo-roster/types";
import { Overview } from "./overview";

/** 계기판 화면은 고른 사람만 받는다(그림 엔진을 운영실 첫 묶음에 넣지 않는다 — B5). 버튼에 손이 가면 미리 받아 전환 때 빈 화면이 안 보이게 한다. */
const loadBoard = () => import("../_instruments/instrument-board");
const InstrumentBoard = dynamic(() => loadBoard().then((m) => m.InstrumentBoard), {
  ssr: false,
  loading: () => <div className="min-h-screen" aria-busy />,
});

/**
 * 운영실 화면 전환 — 같은 스냅샷을 두 모습으로 그린다. 고른 화면은 계정에 남는다(`ui_prefs.dashboard.design`).
 * 누르는 순간 바뀌고 저장은 뒤에서 한다(표시 취향이라 실패해도 화면은 그대로다).
 */
export function DashboardDesignSwitch({ initial, demoRoster, chartKinds, design: initialDesign, checkView }: {
  initial: OverviewSnapshot; demoRoster: DemoRosterControl | null; chartKinds: ChartKinds; design: DashboardDesign; checkView?: CheckView;
}) {
  const [design, setDesign] = useState(initialDesign);
  const [switched, setSwitched] = useState(false);
  const toggle = () => {
    const next: DashboardDesign = design === "instruments" ? "standard" : "instruments";
    setDesign(next);
    setSwitched(true);
    void saveDashboardDesign(next).catch(() => undefined);
  };
  if (design === "instruments") return <InstrumentBoard initial={initial} chartKinds={chartKinds} checkView={checkView} demoRoster={demoRoster} onSwitchDesign={toggle} />;
  return (
    <div className={switched ? "animate-in fade-in-0 duration-200" : undefined}>
      <Overview initial={initial} demoRoster={demoRoster} chartKinds={chartKinds} onSwitchDesign={toggle} onPreloadDesign={() => void loadBoard()} />
    </div>
  );
}
