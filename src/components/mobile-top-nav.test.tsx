import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { MobileTopNav } from "./mobile-top-nav";
import { CONNECTED_APPS } from "@/features/connected-apps/apps";

const actions = vi.hoisted(() => ({ list: vi.fn(), own: vi.fn(), other: vi.fn(), navigate: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/menu", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock("@/components/user-menu", () => ({ UserMenu: () => null }));
vi.mock("@/features/notifications/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/features/assistant/components/assistant-nav-button", () => ({ AssistantNavButton: () => null }));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => false }));
vi.mock("@/components/workspace/shell-home", () => ({ useShellHome: () => "/menu" }));
vi.mock("@/features/owner/navigation-context", () => ({ useNavigationSettings: () => ({ groups: [] }), useMenuPresentation: () => () => null }));
vi.mock("@/lib/nav/assign-top", () => ({ assignTop: actions.navigate }));
vi.mock("@/features/shell/view-actions", () => ({ listTeacherViewTargets: actions.list, switchToTeacherView: actions.own, switchToOtherTeacherView: actions.other }));

beforeEach(() => {
  vi.clearAllMocks();
  actions.list.mockResolvedValue([{ id: "teacher-a", name: "가선생" }]);
  actions.own.mockResolvedValue("/ecs");
  actions.other.mockResolvedValue("/onescreen");
});
afterEach(cleanup);
const props = { systemRole: "admin" as const, email: "admin@example.test", displayName: "나선생" };

it("권한 있는 관리자는 모바일 메뉴에서 다른 강사로 전환하며 목록은 누를 때만 읽는다", async () => {
  render(<MobileTopNav {...props} canOtherTeacherView />);
  expect(screen.queryByRole("button", { name: "강사뷰 전환" })).toBeNull();
  expect(actions.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  expect(actions.list).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "강사뷰 전환" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /가선생/ }));
  await waitFor(() => expect(actions.other).toHaveBeenCalledWith("teacher-a"));
  await waitFor(() => expect(actions.navigate).toHaveBeenCalledWith("/onescreen"));
  expect(actions.own).not.toHaveBeenCalled();
});
it("본인 강사뷰 자격만 있으면 나 항목만 열고 다른 강사 목록은 요청하지 않는다", async () => {
  render(<MobileTopNav {...props} canTeacherView />);
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  fireEvent.click(screen.getByRole("button", { name: "강사뷰 전환" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: /나선생/ }));
  await waitFor(() => expect(actions.own).toHaveBeenCalledTimes(1));
  expect(actions.list).not.toHaveBeenCalled();
  expect(actions.other).not.toHaveBeenCalled();
});
it("두 전환 자격이 없으면 모바일 입구도 보이지 않는다", () => {
  render(<MobileTopNav {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  expect(screen.queryByRole("button", { name: "강사뷰 전환" })).toBeNull();
});
it("모바일과 PC가 같은 서버 판정과 본인 이름을 받는다", () => {
  const layout = readFileSync(join(process.cwd(), "src/app/(shell)/layout.tsx"), "utf8");
  const mobile = layout.slice(layout.indexOf("<MobileTopNav"), layout.indexOf("/>", layout.indexOf("<MobileTopNav")));
  expect(mobile).toContain("canTeacherView={canTeacherView}");
  expect(mobile).toContain("canOtherTeacherView={canOtherTeacherView}");
  expect(mobile).toContain("displayName={user.displayName}");
});
it("연결 앱은 구분된 영역에서 기존 자동 로그인 출발 주소를 새 탭으로 열고 메뉴를 닫는다", () => {
  render(<MobileTopNav {...props} connectedApps={CONNECTED_APPS} />);
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  const link = within(screen.getByRole("region", { name: "연결 앱" })).getByRole("link", { name: "오늘 수학" });
  expect(link.getAttribute("href")).toBe(CONNECTED_APPS[0].launchPath);
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
  link.addEventListener("click", event => event.preventDefault());
  fireEvent.click(link);
  expect(screen.getByRole("button", { name: "메뉴 열기" })).toBeTruthy();
});
it("켜진 연결 앱이 없으면 제목과 빈 영역도 만들지 않는다", () => {
  render(<MobileTopNav {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열기" }));
  expect(screen.queryByRole("region", { name: "연결 앱" })).toBeNull();
});
