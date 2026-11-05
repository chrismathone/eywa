import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NotificationBell } from "./notification-bell";
import { IMPORTANT_NOTIFICATION_TYPES } from "@/features/notifications/important";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  showDesktop: vi.fn(),
  closeMenu: vi.fn(),
  open: vi.fn(),
  mark: vi.fn(),
  clear: vi.fn(),
  fetch: vi.fn(),
  targets: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/features/classnote-reply/server/notification-reply", () => ({ getNotificationReplyContext: mocks.context }));
vi.mock("@/features/classnote-reply/server/reply-actions", () => ({
  getReplyTargetsForNotifications: mocks.targets, getParentReplyContext: vi.fn(),
  requestParentReply: vi.fn(), requestParentReplyDelete: vi.fn(), requestParentReplyEdit: vi.fn(),
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
// 목록 조회는 GET 라우트 fetch(gotchas #137) — 쓰기 액션만 서버 액션이다.
vi.mock("@/features/notifications/fetch-my-notifications", () => ({
  fetchMyNotificationsList: mocks.fetch,
}));
vi.mock("@/features/notifications/server/actions", () => ({
  markNotificationsRead: mocks.mark,
  archiveNotification: vi.fn(),
  unarchiveNotification: vi.fn(),
  deleteNotification: vi.fn(),
  deleteAllNotifications: mocks.clear,
}));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.targets.mockResolvedValue({ targets: {}, reactions: null, vague: [], counts: {} });
  mocks.context.mockResolvedValue({ ok: false, error: "원문 조회 결과" });
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

it.each(["classnote_parent_post", "classnote_parent_comment"])("%s 본문 클릭은 대상 목록 조회 전에도 답글창을 즉시 열고 읽음 처리한다", async (type) => {
  const item = { id: "parent", type, title: "학부모 알림", body: "알림 내용", link: "https://www.classnote.com/service/report/123", read: false, createdAt: "2026-10-01T00:00:00Z" };
  mocks.fetch.mockResolvedValue({ unread: 1, items: [item] });
  mocks.mark.mockResolvedValue({ unread: 0, items: [{ ...item, read: true }] });
  mocks.targets.mockReturnValue(new Promise(() => {})); // 이 조회에 진입을 의존하지 않는다.
  const external = vi.spyOn(window, "open").mockImplementation(() => null);
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(await screen.findByRole("button", { name: /학부모 알림 안 읽음/ }));
  expect(await screen.findByText("원문 조회 결과")).toBeTruthy();
  expect(mocks.context).toHaveBeenCalledWith("parent");
  expect(mocks.mark).toHaveBeenCalledWith(["parent"], "active", 20);
  expect(screen.queryByText("ClassNote로 이동")).toBeNull();
  expect(external).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "← 알림 목록" }));
  expect(await screen.findByRole("button", { name: /학부모 알림.*알림 내용/ })).toBeTruthy();
  external.mockRestore();
});

it("전체 삭제는 확인을 한 번 거친 뒤 지금 뷰만 지운다", async () => {
  mocks.clear.mockResolvedValue({ unread: 0, items: [] });
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  fireEvent.click(await screen.findByRole("button", { name: "전체 삭제" }));
  expect(mocks.clear).not.toHaveBeenCalled(); // 첫 클릭은 확인 줄만
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(mocks.clear).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "전체 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(mocks.clear).toHaveBeenCalledWith("active", 20, "2026-09-11T00:00:00Z");
  expect(await screen.findByText("새 알림이 없습니다")).toBeTruthy();
});

// '다른 강사 뷰'(2026-11-05 강사뷰 적대 리뷰) — 그 강사의 받은함을 보는 중이면 OS 알림 · 중앙 팝업을 띄우지 않고,
// '읽기'면 읽음 · 보관 · 삭제 단추를 감추고 열어도 읽음으로 바꾸지 않는다(서버도 막는다).
it("강사뷰(읽기) — 쓰기 단추가 없고, 열어도 읽음 처리를 보내지 않으며, 중요 알림도 팝업으로 띄우지 않는다", async () => {
  const { showDesktopNotification } = await import("@/features/notifications/desktop-notify");
  const important = { id: "imp", type: IMPORTANT_NOTIFICATION_TYPES[0]!, title: "대상 강사의 중요 알림", body: "본문", link: null, read: false, createdAt: "2026-11-05T00:00:00Z" };
  mocks.fetch.mockResolvedValue({ unread: 1, items: [important], viewAs: true, readOnly: true });
  render(<NotificationBell />);
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  await screen.findByRole("button", { name: /대상 강사의 중요 알림/ });
  expect(screen.queryByRole("button", { name: "모두 읽음" })).toBeNull();
  expect(screen.queryByRole("button", { name: "전체 삭제" })).toBeNull();
  expect(screen.queryByRole("button", { name: /보관$/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /삭제$/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /대상 강사의 중요 알림/ }));
  expect(mocks.mark).not.toHaveBeenCalled();
  expect(showDesktopNotification).not.toHaveBeenCalled();
});

it("평소에는 중요 알림을 팝업으로 띄우고 쓰기 단추가 있다(위 시험의 대조군)", async () => {
  const { showDesktopNotification } = await import("@/features/notifications/desktop-notify");
  const important = { id: "imp2", type: IMPORTANT_NOTIFICATION_TYPES[0]!, title: "내 중요 알림", body: "본문", link: null, read: false, createdAt: "2026-11-05T00:00:00Z" };
  localStorage.removeItem("eywa-notify-alerted");
  mocks.fetch.mockResolvedValue({ unread: 1, items: [important] });
  render(<NotificationBell />);
  await waitFor(() => expect(showDesktopNotification).toHaveBeenCalled());
  fireEvent.click(await screen.findByRole("button", { name: "알림 1개" }));
  expect(await screen.findByRole("button", { name: "모두 읽음" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "전체 삭제" })).toBeTruthy();
});
