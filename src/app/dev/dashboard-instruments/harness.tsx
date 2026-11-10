"use client";

// 개발 전용 샘플: 로그인 없이 '대시보드 전환' 화면을 가상 값으로 띄운다.
import dynamic from "next/dynamic";
import { DEFAULT_CHART_KINDS } from "@/features/dashboard/overview/chart-prefs";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "@/features/dashboard/instruments/testing/fixture";
import { FIXTURE_WORK } from "@/features/work-requests/testing/fixture";

const InstrumentBoard = dynamic(() => import("@/app/(shell)/dashboard/_instruments/instrument-board").then((m) => m.InstrumentBoard), { ssr: false });

export function Harness() {
  return <InstrumentBoard initial={FIXTURE_SNAPSHOT} chartKinds={DEFAULT_CHART_KINDS} demoRoster={null} initialExtras={FIXTURE_EXTRAS} initialWork={FIXTURE_WORK} />;
}
