import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, Suspense, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveView, type ResolvedView } from "@/features/dashboard/layout/view";
import { EMPTY_DASHBOARD, type Bundle } from "@/features/dashboard/layout/types";
import { DEFAULT_LAYOUT } from "@/features/dashboard/overview/layout";
import { MENU_KEYS } from "@/lib/permissions";
import DashboardLoading from "../loading";
import { OverviewDashboard } from "./overview-server";
import { OverviewSkeleton } from "./overview-skeleton";
import { NEW_SHAPE } from "./new-shape-flag";
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
vi.mock("./dashboard-design-switch", () => ({ DashboardDesignSwitch: () => null }));
vi.mock("../_components/getting-started-card", () => ({ GettingStartedCard: () => null }));

/** 기다리면 안 되는 것을 기다리는 퇴행이 30초 시험 시간 초과가 아니라 **원인을 적은 메시지로 빨리** 실패하게. */
function within<T>(promise: Promise<T>, what: string, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${ms}ms 안에 끝나지 않음 — ${what}`)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

const viewOf = (bundle: Bundle, subjectLabels?: string[]): ResolvedView =>
  resolveView({ stored: EMPTY_DASHBOARD, bundle, menus: new Set(MENU_KEYS), subjectLabels });
const html = (el: ReactElement) => {
  const div = document.createElement("div");
  div.innerHTML = renderToStaticMarkup(el);
  return div;
};

describe("운영실 로딩 뼈대 — loading은 머리·KPI 띠까지, 본문은 배치대로", () => {
  // 새 대시보드 모양이 운영실 기본(NEW_SHAPE · 원장 2026-11-09) — loading은 처음부터 새 모양 뼈대(옛 색이 한 번 비치지 않게).
  it("loading.tsx = 새 대시보드(계기판) 뼈대 그대로", () => {
    expect(NEW_SHAPE).toBe(true);
    const markup = renderToStaticMarkup(<DashboardLoading />);
    expect(markup).toBe(renderToStaticMarkup(<InstrumentsSkeleton />));
    expect(markup.length).toBeGreaterThan(0);
    expect(html(<DashboardLoading />).textContent).not.toMatch(/EiE|인재원|2026\.|9월/);
  });

  it("원장 기본(classic) = KPI 띠 + 구역 제목줄(보드 바로 아래 id) + 기본 배치 패널 수", () => {
    const root = html(<OverviewSkeleton view={viewOf("owner")} design="standard" />);
    const board = root.querySelector('[data-overview="board"]')!;
    expect([...board.querySelectorAll(":scope > [id]")].map((el) => el.id)).toEqual(DEFAULT_LAYOUT.sections.map((s) => s.id));
    const panels = DEFAULT_LAYOUT.sections.flatMap((s) => s.panels).reduce((n, p) => n + (p === "followup" ? 2 : 1), 0);
    expect(root.querySelectorAll('[data-overview="panel"]')).toHaveLength(panels);
    expect(root.querySelectorAll('[data-overview="kpi"]')).toHaveLength(9);
  });

  it("회계 기본 배치(자유 격자) = 카드 셋, KPI 띠·구역 격자 없음", () => {
    const root = html(<OverviewSkeleton view={viewOf("accountant")} design="standard" />);
    expect(root.querySelector('[data-overview="free-grid"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-cell="panel"] [data-overview="panel"]')).toHaveLength(3);
    // 칸 높이를 채울 뿐 — 내용 높이(min-height)를 주면 낮은 칸에서 넘쳐 스크롤바가 생긴다.
    expect(root.querySelector('[data-cell] [style*="min-height"]')).toBeNull();
    expect(root.querySelector('[data-overview="kpis"]')).toBeNull();
    expect(root.querySelector('[data-overview="grid"]')).toBeNull();
  });

  it("과목 관리자 기본 배치 = 자유 격자의 KPI 칸 + 카드, 제목에 담당 과목", () => {
    const root = html(<OverviewSkeleton view={viewOf("subject", ["수학"])} design="standard" />);
    expect(root.querySelectorAll('[data-cell="kpi"] [data-overview="kpi"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('[data-cell="panel"] [data-overview="panel"]').length).toBeGreaterThan(0);
    expect(root.querySelector("h1")?.textContent).toContain("(수학)");
    // 담당 과목이 비면 실물도 공지만 — 뼈대도 같은 배치(view)를 따른다.
    const empty = html(<OverviewSkeleton view={viewOf("subject")} design="standard" />);
    expect(empty.querySelectorAll('[data-cell="kpi"]')).toHaveLength(0);
    expect(empty.querySelectorAll('[data-cell="panel"]')).toHaveLength(1);
  });

  it("계기판을 고른 사람은 계기판 뼈대(운영실 표식 없음)", () => {
    const root = html(<OverviewSkeleton view={viewOf("owner")} design="instruments" />);
    expect(root.querySelector('[data-overview="root"]')).toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
  });
});

describe("OverviewDashboard — 배치를 알면 바로 뼈대, 스냅샷은 Suspense 안에서", () => {
  const PREFS = { chartKinds: {}, design: "standard", checkView: "rows" };
  const loaders = () => [mocks.loadOverview, mocks.prefs, mocks.onboarding, mocks.demoRoster];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.raw = {};
  });

  it("네 조회를 같은 순간에 시작한다 — 모두 끝나지 않아도 넷 다 이미 불렸다(직렬 대기 없음)", () => {
    // 어느 하나를 먼저 기다리면(예: 디자인을 읽고 나서 스냅샷 시작) 나머지가 불리지 않아 실패한다.
    for (const fn of loaders()) fn.mockImplementation(() => new Promise(() => undefined));
    void OverviewDashboard({});
    for (const fn of loaders()) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("배치를 알리기 전 실패는 그대로 올라가고(오류 경계로), 다른 조회의 거절은 처리 안 된 채 새지 않는다", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => void unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const boom = new Error("권한 매트릭스를 읽지 못했습니다");
      mocks.loadOverview.mockRejectedValue(boom);
      mocks.prefs.mockResolvedValue(PREFS);
      mocks.raw = { onboarding: () => Promise.reject(new Error("온보딩 실패")), demoRoster: () => Promise.reject(new Error("데모 실패")) };
      await expect(within(OverviewDashboard({}), "배치 전 실패가 올라오지 않고 멈췄다(race에서 스냅샷 경로가 빠졌나)")).rejects.toBe(boom);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("뼈대는 배치·디자인만 기다린다 — 스냅샷·온보딩·데모 어느 것도 끝나지 않아도 그 배치의 fallback을 낸다", async () => {
    const view = viewOf("accountant");
    // 배치만 알리고 스냅샷은 끝나지 않는다. 온보딩·데모도 끝나지 않는다 — 뼈대가 셋 중 하나라도 기다리면 빨리 실패한다.
    mocks.loadOverview.mockImplementation((opts: { onView?: (v: ResolvedView) => void }) => {
      opts.onView?.(view);
      return new Promise(() => undefined);
    });
    mocks.prefs.mockResolvedValue(PREFS);
    mocks.onboarding.mockImplementation(() => new Promise(() => undefined));
    mocks.demoRoster.mockImplementation(() => new Promise(() => undefined));
    const el = await within(OverviewDashboard({ subject: "math" }), "뼈대(fallback)가 스냅샷·온보딩·데모 중 무엇인가를 기다린다");
    expect(mocks.loadOverview.mock.calls[0]![0]).toMatchObject({ subject: "math" });
    expect(isValidElement(el) && el.type).toBe(Suspense);
    const fallback = (el as ReactElement<{ fallback: ReactElement<{ view: ResolvedView; design: string }> }>).props.fallback;
    expect(fallback.type).toBe(OverviewSkeleton);
    expect(fallback.props).toMatchObject({ view, design: NEW_SHAPE ? "instruments" : "standard" });
  });

  it("스냅샷이 배치를 알리지 않고 끝나도(대체 경로) 그 스냅샷의 view로 fallback을 낸다", async () => {
    const view = viewOf("subject", ["수학"]);
    mocks.loadOverview.mockResolvedValue({ view });
    mocks.prefs.mockResolvedValue(PREFS);
    mocks.onboarding.mockResolvedValue(null);
    mocks.demoRoster.mockResolvedValue(null);
    const el = await within(OverviewDashboard({}), "알림 없이 끝난 스냅샷을 대체 경로로 받지 못한다(race에서 스냅샷 view 경로가 빠졌나)");
    const fallback = (el as ReactElement<{ fallback: ReactElement<{ view: ResolvedView }> }>).props.fallback;
    expect(fallback.props.view).toBe(view);
  });
});
