import { Suspense } from "react";
import { loadOverview } from "@/features/dashboard/overview/server";
import { loadDashboardPrefs } from "@/features/dashboard/overview/chart-prefs-server";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { getDemoRosterControl } from "@/features/demo-roster/server/queries";
import { getOnboardingCard } from "@/features/onboarding/server/queries";
import { GettingStartedCard } from "../_components/getting-started-card";
import { DashboardBoard } from "./dashboard-board";
import { InstrumentsSkeleton } from "../_instruments/instruments-skeleton";

/**
 * 운영실 첫 화면 — 뼈대(새 대시보드 모양)를 곧바로 그리고 무거운 스냅샷은 Suspense 안에서 기다린다.
 * 🔴 조회 넷은 같은 순간에 시작한다(직렬 대기 없음). 옛 화면이 쓰던 '배치 먼저 알아내 그 모양 뼈대'는 새 대시보드 하나라 필요 없다(P3-D).
 */
export async function OverviewDashboard({ subject }: { subject?: string } = {}) {
  // '시작하기'는 새 학원(일반판) 원장에게만 · 데모 데이터 드롭다운은 slug가 demo인 원장에게만(다른 지점은 null).
  const initial = loadOverview({ subject });
  const onboarding = getOnboardingCard();
  const demoRoster = getDemoRosterControl();
  const prefs = loadDashboardPrefs();
  // 본문이 받기 전에 실패해도 처리 안 된 거절로 새지 않게 — 본문은 자기 await에서 다시 받는다(실패는 오류 경계로).
  for (const pending of [initial, onboarding, demoRoster, prefs]) void pending.catch(() => undefined);
  return (
    <Suspense fallback={<InstrumentsSkeleton />}>
      <OverviewContent initial={initial} onboarding={onboarding} demoRoster={demoRoster} prefs={prefs} />
    </Suspense>
  );
}

async function OverviewContent({ initial: snapshotPromise, onboarding: onboardingPromise, demoRoster: demoRosterPromise, prefs: prefsPromise }: {
  initial: Promise<OverviewSnapshot>;
  onboarding: ReturnType<typeof getOnboardingCard>;
  demoRoster: ReturnType<typeof getDemoRosterControl>;
  prefs: ReturnType<typeof loadDashboardPrefs>;
}) {
  const [initial, onboarding, demoRoster, prefs] = await Promise.all([snapshotPromise, onboardingPromise, demoRosterPromise, prefsPromise]);
  const showOnboarding = onboarding && !onboarding.dismissed && onboarding.steps.some((s) => !s.done);
  return (
    // 옛 폭 차단(DashboardWidthGate, "창을 넓혀 주세요")은 걷었다 — 원장 2026-09-28 *"작아지면 그냥 모바일 뷰로"*.
    // 데스크톱 셸 경계가 1240(globals.css `desk`)이라 좁은 화면은 모바일 셸로 가고, 사이드바를 넓게 편 좁은 창에선
    // KPI가 접힌다(새 대시보드 CSS).
    <>
      {showOnboarding ? <GettingStartedCard steps={onboarding.steps} /> : null}
      <DashboardBoard initial={initial} demoRoster={demoRoster} chartKinds={prefs.chartKinds} checkView={prefs.checkView} />
    </>
  );
}
