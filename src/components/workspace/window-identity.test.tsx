import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/features/nav/server/visit-actions", () => ({ recordMenuVisit: vi.fn(async () => {}) }));

import { useWindowStore, windowId } from "./window-store";
import { WindowLink, windowIdForHref } from "./window-link";
import { deepLinkWindow } from "./deep-link-window";
import { useOpenMenu } from "./menu-hub-grid";
import { HUB_GROUPS, SUPPORT_GROUPS, type HubDest } from "@/lib/menu-hub";
import { SUBTABS_BY_MENU, navItemByKey, navPresentation } from "@/lib/navigation";
import type { MenuKey } from "@/lib/permissions";
import { SETTINGS_ROLE_GROUPS, settingMenuForHref } from "@/lib/settings-role-catalog";

/**
 * **같은 화면 = 같은 창** — 어느 입구(메뉴 판·검색 팰릿 / 창 링크·알림 벨·주소 직접 입력)로 열어도.
 *
 * 계기(2026-09-11 메뉴·창 이동 전수검사): 경로로 갈리는 면(오늘 출결·출결 모드·셔틀 3면)이 메뉴 판에선
 * 부모 메뉴 창, 링크·알림·딥링크에선 `route:attendance/live` 같은 따로 된 창을 받아 **같은 화면이 두 벌** 떴다.
 * 원장 결정 = **부모 창 하나**(화면 안 면 탭이 이미 부모 창 안에서 바꿔 보여 주는 설계라 그쪽에 맞춘다).
 */

const ALL_DESTS: HubDest[] = [...HUB_GROUPS, ...SUPPORT_GROUPS].flatMap((g) => g.items);
const routePath = (href: string) => href.split(/[?#]/, 1)[0] ?? href;

/**
 * 이 목적지가 열어야 하는 **창의 주인 메뉴**.
 *
 * 2026-10-02부터 설정 면(`/owner?tab=…`·`/lesson-reports?tab=report` 등)의 `menuKey`는 부모 메뉴가 아니라
 * **개별 권한키**(`navigation_settings`·`report_settings`)다 — 권한을 면마다 따로 주기 위해서다.
 * 창은 여전히 부모 메뉴 하나여야 하므로(같은 화면 = 같은 창), 권한키를 그 면이 놓인 부모 메뉴로 되돌려 비교한다.
 * 🔴 `windowIdForHref`와 같은 조회를 쓰지 않는다 — 같은 함수로 기대값을 만들면 검사가 스스로를 확인할 뿐이다.
 */
/**
 * 메뉴 목록 밖이지만 창으로 여는 화면 — 창 id는 메뉴 키가 아니라 **경로**다(창 링크·딥링크가 쓰던 id 그대로).
 * 2026-10-06 키오스크 설정을 설정 메뉴 판에 올리면서 메뉴 판의 목적지에도 이런 화면이 생겼다.
 */
// 학부모 관리 현황(원장·관리자 전용)은 셔틀 탭 줄 밖의 화면이라 제 창이다(navigation.ts 주석).
// 시안 이식 화면(2026-11-09)도 메뉴 창에 접히지 않는 제 창이다(window-link.tsx EXTRA_WINDOW_ROUTES · 원생 상세 하위 /students/care).
const PATH_ID_DESTS: Record<string, string> = {
  "/kiosk-settings": "kiosk-settings", "/shuttle/parents": "shuttle/parents",
  "/dashboard/management/knowledge": "dashboard/management/knowledge", "/students/care": "students/care",
  "/organization/okr": "organization/okr", "/marketing": "marketing", "/billing/management/marketing": "billing/management/marketing",
  "/work-records": "work-records",
};

function ownerMenuOf(d: HubDest): string {
  const byPath = PATH_ID_DESTS[routePath(d.href)];
  if (byPath) return byPath;
  if (settingMenuForHref(d.href) !== d.menuKey) return d.menuKey;
  const parent = (Object.keys(SETTINGS_ROLE_GROUPS) as MenuKey[]).find((k) => navItemByKey(k)?.href === routePath(d.href));
  return parent ?? d.menuKey;
}

/** 하부탭 중 **경로로 갈리는 면**(부모 루트와 다른 경로, 독립 메뉴 아님) — SUBTABS_BY_MENU에서 파생한다. */
const PATH_FACES = Object.entries(SUBTABS_BY_MENU).flatMap(([parent, tabs]) =>
  (tabs ?? [])
    .filter((t) => !t.menuKey && routePath(t.href) !== navItemByKey(parent as MenuKey)?.href)
    .map((t) => ({ parent, href: t.href })),
);

function resetStore() {
  useWindowStore.setState({
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

/** 메뉴 판(과 같은 함수를 쓰는 검색 팰릿)으로 연다. */
function openViaHub(href: string) {
  const dest = ALL_DESTS.find((d) => d.href === href);
  if (!dest) throw new Error(`메뉴 판에 없는 목적지: ${href}`);
  const { result, unmount } = renderHook(() => useOpenMenu());
  act(() => result.current(dest));
  unmount();
}

/** 창 링크(WindowLink — 알림 벨·딥링크와 같은 창 id 규약)로 연다. 기본 이동을 막았으면 false. */
function clickLink(href: string): boolean {
  render(<WindowLink href={href}>열기</WindowLink>);
  const notPrevented = fireEvent.click(screen.getByText("열기"));
  cleanup();
  return notPrevented;
}

const openOrder = () => useWindowStore.getState().order;

describe("windowIdForHref — 경로로 갈리는 면은 부모 메뉴 창", () => {
  it("면 목록이 비지 않았다(파생이 조용히 0건이 되면 아래 검사가 전부 헛통과한다)", () => {
    expect(PATH_FACES.map((f) => f.href)).toEqual(
      expect.arrayContaining([
        "/attendance/live",
        "/attendance/quick",
        "/shuttle/today",
        "/shuttle/live",
        "/shuttle/track",
      ]),
    );
  });

  it("🔴 경로로 갈리는 면은 쿼리가 붙어도 부모 메뉴 창 id다", () => {
    for (const f of PATH_FACES) {
      expect(windowIdForHref(f.href)?.id, f.href).toBe(f.parent);
      expect(windowIdForHref(`${f.href}?tab=desk`)?.id, f.href).toBe(f.parent);
    }
  });

  it("면이 아닌 하위 경로(상세)는 종전대로 제 창이다", () => {
    expect(windowIdForHref("/attendance/2026-09-11/abc")?.id).toBe("attendance/2026-09-11/abc");
    expect(windowIdForHref("/attendance/live/extra")?.id).toBe("attendance/live/extra");
  });

  it("🔴 독립 메뉴 하부탭(/mcs)은 제 메뉴 창 — 메뉴 목록(NAV_GROUPS)에 없어도 null로 떨어지지 않는다", () => {
    expect(windowIdForHref("/mcs")).toEqual({ id: "mcs", navLabel: "수학 강사 시트" });
    expect(windowIdForHref("/mcs?month=2026-09")?.id).toBe("mcs");
    expect(windowIdForHref("/mcs/abc/month")?.id).toBe("mcs/abc/month");
  });
});

describe("모든 입구가 같은 창 id", () => {
  it("🔴 메뉴 판(=검색 팰릿) 목적지 전부 — 창 링크·알림·딥링크와 같은 id", () => {
    const mismatched = ALL_DESTS.filter((d) => {
      const item = navItemByKey(d.menuKey);
      // 운영실 = 셸 본문이 곧 작업면(창이 아니다).
      if (item && item.href === d.href && navPresentation(item) === "desktop") return false;
      return windowIdForHref(d.href)?.id !== ownerMenuOf(d);
    }).map((d) => d.href);
    expect(mismatched).toEqual([]);
    // 설정 면이 실제로 부모 창으로 접히는지 — 위 비교가 빈 목록으로 통과하는 것만으로는 대상이 있었는지 알 수 없다.
    const settingFaces = ALL_DESTS.filter((d) => settingMenuForHref(d.href) === d.menuKey);
    expect(settingFaces.length).toBeGreaterThan(0);
    // 창 id는 권한키(`report_settings`)가 아니라 **그 면이 놓인 메뉴**여야 한다 — 권한키로 열리면 같은 화면이 두 벌 뜬다.
    for (const d of settingFaces) {
      const id = windowIdForHref(d.href)?.id;
      expect(id, d.href).not.toBe(d.menuKey);
      expect(navItemByKey(id as MenuKey)?.href, d.href).toBe(routePath(d.href));
    }
  });

  it("🔴 딥링크(주소 직접 입력)도 같은 창", () => {
    for (const f of PATH_FACES) {
      expect(deepLinkWindow(f.href, "화면 — 에이와")?.id, f.href).toBe(f.parent);
    }
  });

  it("메뉴 판은 창 id를 windowIdForHref로 정한다(규칙이 두 벌이 되지 않게)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/workspace/menu-hub-grid.tsx"), "utf8");
    expect(src).toContain("windowIdForHref(dest.href)");
  });
});

describe("실제로 창이 하나만 뜨는가", () => {
  beforeEach(resetStore);
  afterEach(cleanup);

  const ATT = windowId("route", "attendance");

  it("🔴 메뉴 판 '오늘 출결' 뒤 알림 링크(오늘 출결 ?tab=desk) → 창 하나, 그 주소로", () => {
    openViaHub("/attendance/live");
    clickLink("/attendance/live?tab=desk");
    expect(openOrder()).toEqual([ATT]);
    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance/live?tab=desk");
  });

  it("🔴 거꾸로 — 링크로 연 오늘 출결 창을 메뉴 판이 알아본다", () => {
    clickLink("/attendance/live?tab=desk");
    openViaHub("/attendance/live");
    expect(openOrder()).toEqual([ATT]);
    expect(useWindowStore.getState().windows[ATT]?.params.href).toBe("/attendance/live");
  });

  it("셔틀 면도 부모 셔틀 창 하나다", () => {
    openViaHub("/shuttle");
    clickLink("/shuttle/today");
    expect(openOrder()).toEqual([windowId("route", "shuttle")]);
  });

  it("🔴 /mcs 링크는 창을 연다 — 최상위 프레임 이동(창에 가려 안 보임)으로 떨어지지 않는다", () => {
    expect(clickLink("/mcs")).toBe(false);
    expect(openOrder()).toEqual([windowId("route", "mcs")]);
    openViaHub("/mcs");
    expect(openOrder()).toEqual([windowId("route", "mcs")]);
  });
});

describe("옛 창(경로 id로 저장된 창) — 복원에서 깨지지 않고 레거시로 남는다", () => {
  const STORAGE_KEY = "eywa-workspace";
  beforeEach(resetStore);
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    cleanup();
  });

  it("route:attendance/live로 저장된 창은 그대로 복원되고, 메뉴 판은 새 규칙의 부모 창을 연다", async () => {
    const legacy = windowId("route", "attendance/live");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        state: {
          owner: null,
          windows: {
            [legacy]: {
              id: legacy,
              kind: "route",
              params: { id: "attendance/live", title: "오늘 출결", href: "/attendance/live" },
              rect: { x: 24, y: 24, w: 1280, h: 620 },
              minimized: false,
              maximized: false,
            },
          },
          order: [legacy],
          focusedId: legacy,
        },
        version: useWindowStore.persist.getOptions().version ?? 0,
      }),
    );
    await useWindowStore.persist.rehydrate();
    expect(useWindowStore.getState().windows[legacy]?.params.href).toBe("/attendance/live");
    // 옛 창은 지우지 않는다(사람이 닫으면 끝나는 잔여) — 새 입구는 새 규칙의 부모 창을 연다.
    openViaHub("/attendance/live");
    expect(openOrder()).toEqual([legacy, windowId("route", "attendance")]);
  });
});

describe("windowIdForHref — 관리자 전용 셔틀 면", () => {
  it("실시간 위치는 탭 줄에서 빠졌어도(2026-10-08) 셔틀 창으로 열린다", () => {
    expect(windowIdForHref("/shuttle/track")?.id).toBe("shuttle");
    expect(windowIdForHref("/shuttle/track?season=term")?.id).toBe("shuttle");
  });
});
