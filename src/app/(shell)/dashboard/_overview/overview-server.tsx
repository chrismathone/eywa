import { loadOverview } from "@/features/dashboard/overview/server";
import { getDemoRosterControl } from "@/features/demo-roster/server/queries";
import { getOnboardingCard } from "@/features/onboarding/server/queries";
import { GettingStartedCard } from "../_components/getting-started-card";
import { Overview } from "./overview";

export async function OverviewDashboard() {
  // '시작하기'는 새 학원(일반판) 원장에게만 — 침산은 null이라 아래 Overview만 그려진다(이 작업 전과 같은 화면).
  // 데모 데이터 드롭다운은 slug가 demo인 원장에게만. 다른 지점은 null.
  const [initial, onboarding, demoRoster] = await Promise.all([
    loadOverview(),
    getOnboardingCard(),
    getDemoRosterControl(),
  ]);
  const showOnboarding = onboarding && !onboarding.dismissed && onboarding.steps.some((s) => !s.done);
  return (
    <>
      {showOnboarding ? <GettingStartedCard steps={onboarding.steps} /> : null}
      <Overview initial={initial} demoRoster={demoRoster} />
    </>
  );
}
