import { Suspense } from "react";
import { NEW_SHAPE } from "./new-shape-flag";
import { loadOverview } from "@/features/dashboard/overview/server";
import { loadDashboardPrefs } from "@/features/dashboard/overview/chart-prefs-server";
import type { ResolvedView } from "@/features/dashboard/layout/view";
import type { OverviewSnapshot } from "@/features/dashboard/overview/model";
import { getDemoRosterControl } from "@/features/demo-roster/server/queries";
import { getOnboardingCard } from "@/features/onboarding/server/queries";
import { GettingStartedCard } from "../_components/getting-started-card";
import { DashboardDesignSwitch } from "./dashboard-design-switch";
import { OverviewSkeleton } from "./overview-skeleton";

/**
 * 운영실 첫 화면 — **배치(역할·저장 배치·디자인)를 먼저** 알아내 그 모양의 뼈대를 그리고, 무거운 스냅샷은 Suspense 안에서 기다린다
 * (원장 2026-11-05 — `loading.tsx`는 머리·KPI 띠까지만, 본문 자리는 여기서 역할에 맞게).
 *
 * 🔴 조회는 전과 **같은 넷을 같은 순간에** 시작한다(직렬 대기를 새로 만들지 않는다). 바뀐 것은 무엇을 먼저 그리느냐뿐:
 *    - 배치(`view`)는 `loadOverview`가 권한·설정·역할 판정만 끝낸 시점에 `onView`로 알려 준다 — 같은 조회를 따로 또 읽지 않는다.
 *    - 디자인은 원래도 따로 읽던 `ui_prefs` 한 줄(`loadDashboardPrefs`).
 *    둘 다 가벼워 뼈대는 곧 뜨고, 스냅샷이 다 끝나는 시각은 전과 같다(무거운 영역 조회는 그사이에도 계속 돈다).
 */
export async function OverviewDashboard({ subject }: { subject?: string } = {}) {
  const { promise: earlyView, notify: viewReady } = viewSignal();
  // '시작하기'는 새 학원(일반판) 원장에게만 — 침산은 null이라 아래 Overview만 그려진다(이 작업 전과 같은 화면).
  // 데모 데이터 드롭다운은 slug가 demo인 원장에게만. 다른 지점은 null.
  const initial = loadOverview({ subject, onView: viewReady });
  const onboarding = getOnboardingCard();
  const demoRoster = getDemoRosterControl();
  const prefs = loadDashboardPrefs();
  // 배치 판정이 실패해 본문까지 못 가도 처리 안 된 거절로 새지 않게 — 본문은 자기 await에서 다시 받는다.
  for (const pending of [onboarding, demoRoster]) void pending.catch(() => undefined);
  // 스냅샷이 배치를 알리기 전에 실패하면 그 실패가 그대로 올라간다(전처럼 오류 경계로) — 알렸으면 그 값, 못 알리고 끝났으면 스냅샷의 값.
  const [view, { design }] = await Promise.all([Promise.race([earlyView, initial.then((snapshot) => snapshot.view)]), prefs]);
  return (
    <Suspense fallback={<OverviewSkeleton view={view} design={NEW_SHAPE ? "instruments" : design} />}>
      <OverviewContent initial={initial} onboarding={onboarding} demoRoster={demoRoster} prefs={prefs} />
    </Suspense>
  );
}

/** 배치 알림(`onView`)을 기다릴 수 있는 약속으로 바꾼다. */
function viewSignal(): { promise: Promise<ResolvedView>; notify: (view: ResolvedView) => void } {
  let notify: (view: ResolvedView) => void = () => undefined;
  const promise = new Promise<ResolvedView>((resolve) => {
    notify = resolve;
  });
  return { promise, notify };
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
    // KPI가 4×2로 접힌다(appearance.module.css).
    <>
      {showOnboarding ? <GettingStartedCard steps={onboarding.steps} /> : null}
      <DashboardDesignSwitch initial={initial} demoRoster={demoRoster} chartKinds={prefs.chartKinds} design={prefs.design} checkView={prefs.checkView} />
    </>
  );
}
