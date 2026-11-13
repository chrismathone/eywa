import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/dashboard", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/features/notifications/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/other-teacher-view", () => ({ TeacherViewSwitcher: () => null }));
vi.mock("@/features/nav/server/visit-actions", () => ({ recordMenuVisit: vi.fn(async () => {}) }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/components/workspace/use-sidebar-resize", () => ({
  useSidebarWidth: () => ({ expanded: true, width: 216 }),
  railWidth: () => 216,
}));

import { AppSidebar } from "./app-sidebar";
import { useWindowStore, windowId } from "./workspace/window-store";
import { useMenuHub } from "./workspace/menu-hub-store";
import { NavigationProvider } from "@/features/owner/navigation-context";
import { WorkspaceEnabledProvider } from "./workspace/workspace-enabled";
import { MenuHubPanel } from "./workspace/menu-hub-panel";

/**
 * 사이드바 **'지금 보는 곳' 표시는 포커스 창이 지금 보여 주는 주소로 판정한다** — 창 id가 아니라.
 *
 * 계기(2026-09-11 메뉴·창 이동 전수검사): 창 id 비교(`route:<menuKey>` === 포커스)라서 ① 알림·링크로 연
 * 경로 창(`route:attendance/live`)·상세 창(`route:students/abc`)이 앞이면 켜지는 줄이 하나도 없었고,
 * ② 메뉴 판이 캔버스를 덮고 있어도 판 뒤에 가려진 창의 줄까지 켜져 두 업무군이 동시에 칠해졌다.
 * 원장 규칙(2026-09-09 *"현재 보고 있는 창만 탭에서 표시"*)은 그대로다 — 켜지는 것은 지금 보이는 곳 하나.
 */

function focusWindow(paramId: string, href: string, navTop?: string) {
  const id = windowId("route", paramId);
  useWindowStore.setState({
    windows: {
      [id]: {
        id,
        kind: "route",
        params: { id: paramId, title: "창", href },
        rect: { x: 0, y: 0, w: 800, h: 600 },
        minimized: false,
        maximized: false,
      },
    },
    order: [id],
    focusedId: id,
    nav: navTop ? { [id]: [navTop] } : {},
    live: {},
  });
}

const renderSidebar = () =>
  render(<AppSidebar systemRole="master" email="owner@example.com" displayName="원장" />);
const rowCurrent = (label: string) =>
  screen.getByRole("link", { name: label }).getAttribute("aria-current") === "page";
const groupActive = (label: string) =>
  (screen.queryByRole("link", { name: label })?.getAttribute("aria-current") === "page")
  || screen.getByRole("button", { name: `${label} 메뉴` }).className.includes("text-primary-foreground");

describe("사이드바 '지금 보는 곳' — 포커스 창의 지금 주소로 판정", () => {
  beforeEach(() => {
    nav.pathname = "/dashboard";
    nav.search = "";
    useMenuHub.setState({ groupId: null });
    useWindowStore.setState({ windows: {}, order: [], focusedId: null, nav: {}, live: {} });
  });
  afterEach(cleanup);

  it("출석부 창을 보면 '출석부' 줄과 '수업' 업무군이 켜진다(종전 그대로)", () => {
    focusWindow("attendance", "/attendance");
    renderSidebar();
    expect(rowCurrent("출석부")).toBe(true);
    expect(groupActive("수업")).toBe(true);
    expect(groupActive("원생")).toBe(false);
  });

  it("🔴 알림·링크로 연 옛 경로 창(route:attendance/live)도 같은 곳을 가리킨다", () => {
    focusWindow("attendance/live", "/attendance/live");
    renderSidebar();
    expect(rowCurrent("출석부")).toBe(true);
    expect(groupActive("수업")).toBe(true);
  });

  it("🔴 상세 창(원생 상세)이 앞이면 '원생목록'·'원생'이 켜진다", () => {
    focusWindow("students/abc", "/students/abc");
    renderSidebar();
    expect(rowCurrent("원생목록")).toBe(true);
    expect(groupActive("원생")).toBe(true);
  });

  it("🔴 학생 요약 창(검색 팰릿에서 연 원생 — 주소가 없는 창)이 앞이면 '원생목록'·'원생'이 켜진다", () => {
    const id = windowId("student", "abc");
    useWindowStore.setState({
      windows: {
        [id]: {
          id,
          kind: "student",
          params: { id: "abc", title: "김지유" },
          rect: { x: 0, y: 0, w: 480, h: 560 },
          minimized: false,
          maximized: false,
        },
      },
      order: [id],
      focusedId: id,
      nav: {},
      live: {},
    });
    renderSidebar();
    expect(rowCurrent("원생목록")).toBe(true);
    expect(groupActive("원생")).toBe(true);
  });

  it("🔴 창 안에서 다른 화면으로 드릴인했으면 지금 주소를 따른다(창 id가 아니라)", () => {
    focusWindow("students", "/students", "/classes/xyz?embed=1");
    renderSidebar();
    expect(groupActive("수업")).toBe(true);
    expect(groupActive("원생")).toBe(false);
    expect(rowCurrent("원생목록")).toBe(false);
  });

  it("🔴 메뉴 판이 떠 있으면 판의 업무군만 켜진다 — 판에 가려 안 보이는 창의 줄은 끈다", () => {
    focusWindow("timetable", "/timetable");
    useMenuHub.setState({ groupId: "student" });
    renderSidebar();
    expect(groupActive("원생")).toBe(true);
    expect(groupActive("수업")).toBe(false);
    expect(rowCurrent("시간표")).toBe(false);
  });

  it("창이 없으면(빈 작업면) 대시보드 줄만 켜진다", () => {
    renderSidebar();
    expect(rowCurrent("대시보드")).toBe(true);
    expect(rowCurrent("출석부")).toBe(false);
    expect(groupActive("수업")).toBe(false);
  });

  it("창 모드를 꺼도 면을 옮긴 새 탭이 현재 위치로 표시된다", () => {
    nav.pathname = "/attendance/live";
    nav.search = "date=2026-09-01";
    const menus = [{ href: "/attendance/live", groupId: "custom-office" }];
    render(<NavigationProvider menus={menus} groups={[{ id: "custom-office", label: "교무실" }]}>
      <WorkspaceEnabledProvider enabled={false}>
        <AppSidebar systemRole="master" email="owner@example.com" displayName="원장" menuLayout={menus} />
      </WorkspaceEnabledProvider>
    </NavigationProvider>);
    expect(groupActive("교무실")).toBe(true);
    expect(groupActive("수업")).toBe(false);
  });

  it.each([
    ["원생", "students", "student"],
    ["상담·재원", "consultations", "counsel"],
  ])("관리자가 %s 탭을 누르면 기존 목록 창이 있어도 통계를 열고 하위 메뉴도 펼칠 수 있다", (label, path, group) => {
    focusWindow(path, `/${path}?list=1`);
    renderSidebar();
    const tab = screen.getByRole("link", { name: label });
    expect(tab).toHaveAttribute("href", `/${path}/stats`);
    fireEvent.click(tab);
    const state = useWindowStore.getState();
    expect(state.windows[state.focusedId!]?.params.href).toBe(`/${path}/stats`);
    fireEvent.click(screen.getByRole("button", { name: `${label} 메뉴` }));
    expect(useMenuHub.getState().groupId).toBe(group);
  });

  it("학원 설정에서 원생목록을 숨기면 통계 바로가기도 숨긴다", () => {
    const menus = [{ href: "/students", hidden: true }];
    render(<NavigationProvider menus={menus}>
      <AppSidebar systemRole="admin" email="admin@example.com" displayName="관리자" menuLayout={menus} />
    </NavigationProvider>);
    expect(screen.queryByRole("link", { name: "원생" })).toBeNull();
    expect(screen.getByRole("button", { name: "원생 메뉴" })).toBeInTheDocument();
  });

  it("상담·재원 하위 메뉴에서도 통계와 신규 콜&상담을 고를 수 있다", () => {
    render(<><AppSidebar systemRole="admin" email="admin@example.com" displayName="관리자" /><MenuHubPanel systemRole="admin" /></>);
    fireEvent.click(screen.getByRole("button", { name: "상담·재원 메뉴" }));
    const menu = within(screen.getByRole("dialog", { name: "상담·재원 메뉴" }));
    expect(menu.getByRole("button", { name: /신규 콜&상담/ })).toBeInTheDocument();
    fireEvent.click(menu.getByRole("button", { name: /상담 통계/ }));
    const state = useWindowStore.getState();
    expect(state.windows[state.focusedId!]?.params.href).toBe("/consultations/stats");
  });
});
