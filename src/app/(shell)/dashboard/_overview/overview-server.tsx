import { loadOverview } from "@/features/dashboard/overview/server";
import { loadDashboardPrefs } from "@/features/dashboard/overview/chart-prefs-server";
import { getDemoRosterControl } from "@/features/demo-roster/server/queries";
import { getOnboardingCard } from "@/features/onboarding/server/queries";
import { GettingStartedCard } from "../_components/getting-started-card";
import { DashboardDesignSwitch } from "./dashboard-design-switch";

export async function OverviewDashboard({ subject }: { subject?: string } = {}) {
  // '시작하기'는 새 학원(일반판) 원장에게만 — 침산은 null이라 아래 Overview만 그려진다(이 작업 전과 같은 화면).
  // 데모 데이터 드롭다운은 slug가 demo인 원장에게만. 다른 지점은 null.
  const [initial, onboarding, demoRoster, prefs] = await Promise.all([
    loadOverview({ subject }),
    getOnboardingCard(),
    getDemoRosterControl(),
    loadDashboardPrefs(),
  ]);
  const showOnboarding = onboarding && !onboarding.dismissed && onboarding.steps.some((s) => !s.done);
  return (
    // 옛 폭 차단(DashboardWidthGate, "창을 넓혀 주세요")은 걷었다 — 원장 2026-09-28 *"작아지면 그냥 모바일 뷰로"*.
    // 데스크톱 셸 경계가 1240(globals.css `desk`)이라 좁은 화면은 모바일 셸로 가고, 사이드바를 넓게 편 좁은 창에선
    // KPI가 4×2로 접힌다(appearance.module.css).
    <>
      {showOnboarding ? <GettingStartedCard steps={onboarding.steps} /> : null}
      <DashboardDesignSwitch initial={initial} demoRoster={demoRoster} chartKinds={prefs.chartKinds} design={prefs.design} checkView={prefs.checkView} />
    </>
  );
}
