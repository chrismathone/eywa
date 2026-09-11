import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWindowStore, windowId } from "@/components/workspace/window-store";
import { useMenuHub } from "@/components/workspace/menu-hub-store";
import { NotificationBell } from "./notification-bell";

/**
 * 알림 벨로 연 화면도 **메뉴 판으로 연 같은 화면과 같은 창**이다(2026-09-11 메뉴·창 이동 전수검사 —
 * 오늘 출결 창이 두 벌 떴다). 창 id 규칙은 `windowIdForHref` 하나라 여기선 **실제 함수·실제 창 스토어**로
 * 확인한다(그 둘을 목업하면 이 검사가 헛돈다 — 옆 notification-bell.test.tsx는 목업을 쓴다).
 */

const mocks = vi.hoisted(() => ({ push: vi.fn(), mark: vi.fn(), fetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/components/workspace/use-is-desktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/components/workspace/workspace-enabled", () => ({ useWorkspaceEnabled: () => true }));
vi.mock("@/features/notifications/desktop-notify", () => ({
  isTopFrame: () => true,
  showDesktopNotification: vi.fn(),
}));
vi.mock("@/features/notifications/notify-permission-store", () => ({
  useNotifyPermission: () => "granted",
  enableDesktopNotify: vi.fn(),
}));
vi.mock("./mobile-push-row", () => ({ MobilePushRow: () => null }));
vi.mock("./notification-alert-dialog", () => ({ NotificationAlertDialog: () => null }));
vi.mock("@/features/notifications/server/actions", () => ({
  fetchMyNotifications: mocks.fetch,
  markNotificationsRead: mocks.mark,
  archiveNotification: vi.fn(),
  unarchiveNotification: vi.fn(),
  deleteNotification: vi.fn(),
}));

const ITEM = {
  id: "n1",
  type: "absence_alert",
  title: "결석 알림",
  body: "김지유 결석 — 데스크 확인",
  link: "/attendance/live?tab=desk",
  read: false,
  createdAt: "2026-09-11T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  useWindowStore.setState({ windows: {}, order: [], focusedId: null, live: {}, nav: {}, cached: [] });
  mocks.fetch.mockResolvedValue({ unread: 1, items: [ITEM] });
  mocks.mark.mockResolvedValue({ unread: 0, items: [{ ...ITEM, read: true }] });
});
afterEach(cleanup);

it("🔴 메뉴 판으로 연 '오늘 출결' 창이 있으면 출결 알림은 그 창을 그 주소로 보낸다 — 창을 하나 더 만들지 않는다", async () => {
  const ATT = windowId("route", "attendance");
  // 메뉴 판 '도구 > 오늘 출결'이 여는 그 창(부모 메뉴 창 id).
  useWindowStore.getState().open("route", { id: "attendance", title: "오늘 출결", href: "/attendance/live" });

  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(await screen.findByRole("button", { name: /결석 알림 안 읽음/ }));

  const s = useWindowStore.getState();
  expect(s.order).toEqual([ATT]);
  expect(s.windows[ATT]?.params.href).toBe("/attendance/live?tab=desk");
  expect(mocks.push).not.toHaveBeenCalled();
});

it("🔴 메뉴 판이 떠 있어도 알림으로 연 창이 판 밑에 깔리지 않는다 — 창을 열며 판을 닫는다", async () => {
  // 메뉴 판(z-44)은 창 캔버스(z-40)를 덮는다 — 판을 두면 방금 연 창이 판 밑에서 안 보인다(2026-09-11 리뷰).
  useMenuHub.setState({ groupId: "class" });
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(await screen.findByRole("button", { name: /결석 알림 안 읽음/ }));
  expect(useWindowStore.getState().windows[windowId("route", "attendance")]).toBeTruthy();
  expect(useMenuHub.getState().groupId).toBeNull();
});
