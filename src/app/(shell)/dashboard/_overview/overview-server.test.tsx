import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, Suspense, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardLoading from "../loading";
import { OverviewDashboard } from "./overview-server";
import { InstrumentsSkeleton } from "../_instruments/instruments-skeleton";

const mocks = vi.hoisted(() => ({
  loadOverview: vi.fn(),
  prefs: vi.fn(),
  onboarding: vi.fn(),
  demoRoster: vi.fn(),
  /**
   * `vi.fn`이 돌려준 promise엔 vitest가 결과 기록용 핸들러를 달아 거절이 늘 '처리됨'으로 보인다 — 처리 안 된 거절을 보는 시험은
   * 이 원시 함수(있으면 우선)로 vi.fn을 거치지 않은 거절을 돌려준다.
   */
  raw: {} as { onboarding?: () => Promise<never>; demoRoster?: () => Promise<never> },
}));
vi.mock("@/features/dashboard/overview/server", () => ({ loadOverview: mocks.loadOverview }));
vi.mock("@/features/dashboard/overview/chart-prefs-server", () => ({ loadDashboardPrefs: mocks.prefs }));
vi.mock("@/features/onboarding/server/queries", () => ({ getOnboardingCard: () => (mocks.raw.onboarding ? mocks.raw.onboarding() : mocks.onboarding()) }));
vi.mock("@/features/demo-roster/server/queries", () => ({ getDemoRosterControl: () => (mocks.raw.demoRoster ? mocks.raw.demoRoster() : mocks.demoRoster()) }));
vi.mock("./dashboard-board", () => ({ DashboardBoard: () => null }));
vi.mock("../_components/getting-started-card", () => ({ GettingStartedCard: () => null }));

/** 기다리면 안 되는 것을 기다리는 퇴행이 30초 시험 시간 초과가 아니라 **원인을 적은 메시지로 빨리** 실패하게. */
function within<T>(promise: Promise<T>, what: string, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${ms}ms 안에 끝나지 않음 — ${what}`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const html = (el: ReactElement) => {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(el);
  return div;
};

describe("운영실 로딩 뼈대 = 새 대시보드(계기판) 뼈대 하나(원장 2026-11-09 · P3-D)", () => {
  it("loading.tsx = 새 대시보드(계기판) 뼈대 그대로", () => {
    const markup = renderToStaticMarkup(<DashboardLoading />);
    expect(markup).toBe(renderToStaticMarkup(<InstrumentsSkeleton />));
    expect(markup.length).toBeGreaterThan(0);
    expect(html(<DashboardLoading />).textContent).not.toMatch(/EiE|인재원|2026\.|9월/);
  });

});

describe("OverviewDashboard — 뼈대는 곧바로, 스냅샷은 Suspense 안에서", () => {
  const PREFS = { chartKinds: {}, checkView: "rows" };
  const loaders = () => [mocks.loadOverview, mocks.prefs, mocks.onboarding, mocks.demoRoster];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raw = {};
  });

  it("네 조회를 같은 순간에 시작한다 — 모두 끝나지 않아도 넷 다 이미 불렸다(직렬 대기 없음)", () => {
    for (const fn of loaders()) fn.mockImplementation(() => new Promise(() => undefined));
    void OverviewDashboard({});
    for (const fn of loaders()) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("어느 조회도 끝나지 않아도 계기판 뼈대 fallback을 낸다(과목도 넘긴다)", async () => {
    for (const fn of loaders()) fn.mockImplementation(() => new Promise(() => undefined));
    const el = await within(OverviewDashboard({ subject: "math" }), "뼈대(fallback)가 무엇인가를 기다린다");
    expect(mocks.loadOverview.mock.calls[0]![0]).toMatchObject({ subject: "math" });
    expect(isValidElement(el) && el.type).toBe(Suspense);
    const fallback = (el as ReactElement<{ fallback: ReactElement }>).props.fallback;
    expect(fallback.type).toBe(InstrumentsSkeleton);
  });

  it("조회 거절은 처리 안 된 채 새지 않는다(본문 await가 받아 오류 경계로)", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      mocks.loadOverview.mockImplementation(() => Promise.reject(new Error("스냅샷 실패")));
      mocks.prefs.mockResolvedValue(PREFS);
      mocks.raw = { onboarding: () => Promise.reject(new Error("온보딩 실패")), demoRoster: () => Promise.reject(new Error("데모 실패")) };
      await within(OverviewDashboard({}), "뼈대가 멈췄다");
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
