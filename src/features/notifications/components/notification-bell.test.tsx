import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  showDesktop: vi.fn(),
  closeMenu: vi.fn(),
  open: vi.fn(),
  mark: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => "/dashboard",
}));
vi.mock("@/components/workspace/window-store", () => ({
  useWindowStore: {
    getState: () => ({ open: mocks.open, showDesktop: mocks.showDesktop }),
  },
}));
vi.mock("@/components/workspace/menu-hub-store", () => ({
  useMenuHub: { getState: () => ({ close: mocks.closeMenu }) },
}));
vi.mock("@/components/workspace/window-link", () => ({
  windowIdForHref: () => null,
}));
vi.mock("@/components/workspace/use-is-desktop", () => ({
  useIsDesktop: () => true,
}));
vi.mock("@/components/workspace/workspace-enabled", () => ({
  useWorkspaceEnabled: () => true,
}));
vi.mock("@/features/notifications/desktop-notify", () => ({
  isTopFrame: () => true,
  showDesktopNotification: vi.fn(),
}));
vi.mock("@/features/notifications/notify-permission-store", () => ({
  useNotifyPermission: () => "granted",
  enableDesktopNotify: vi.fn(),
}));
vi.mock("./mobile-push-row", () => ({ MobilePushRow: () => null }));
vi.mock("./notification-alert-dialog", () => ({
  NotificationAlertDialog: () => null,
}));
vi.mock("@/features/notifications/server/actions", () => ({
  fetchMyNotifications: mocks.fetch,
  markNotificationsRead: mocks.mark,
  archiveNotification: vi.fn(),
  unarchiveNotification: vi.fn(),
  deleteNotification: vi.fn(),
}));
beforeEach(() => {
  vi.clearAllMocks();
  const response = {
    unread: 1,
    items: [
      {
        id: "n1",
        type: "absence_alert",
        title: "반복 결석 학생",
        body: "김지유 학생 출결 확인",
        link: "/dashboard#repeated-absences",
        read: false,
        createdAt: "2026-09-11T00:00:00Z",
      },
    ],
  };
  mocks.fetch.mockResolvedValue(response);
  mocks.mark.mockResolvedValue({
    ...response,
    unread: 0,
    items: response.items.map((item) => ({ ...item, read: true })),
  });
});
afterEach(cleanup);
it("대시보드 알림은 열린 작업창을 최소화하고 해당 카드로 이동하며 메뉴를 닫는다", async () => {
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: /반복 결석 학생 안 읽음 김지유/,
    }),
  );
  expect(mocks.showDesktop).toHaveBeenCalledOnce();
  expect(mocks.closeMenu).toHaveBeenCalledOnce();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(mocks.push).toHaveBeenCalledWith("/dashboard#repeated-absences");
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: /김지유 학생 출결 확인/ }),
    ).toBeNull(),
  );
});
it("보관함 알림을 읽을 때 받은함 응답으로 바뀌지 않는다", async () => {
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(await screen.findByRole("button", { name: "보관함" }));
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith("archived", 20));
  fireEvent.click(
    await screen.findByRole("button", {
      name: /반복 결석 학생 안 읽음 김지유/,
    }),
  );
  expect(mocks.mark).toHaveBeenCalledWith(["n1"], "archived", 20);
});
