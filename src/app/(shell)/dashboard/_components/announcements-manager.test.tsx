import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AnnouncementsManager } from "./announcements-manager";
import { deleteAnnouncement } from "@/features/dashboard/server/actions";

vi.mock("@/features/dashboard/server/actions", () => ({
  createAnnouncement: vi.fn(async () => ({ ok: true })),
  updateAnnouncement: vi.fn(async () => ({ ok: true })),
  deleteAnnouncement: vi.fn(async () => ({ ok: true })),
  toggleAnnouncementPin: vi.fn(async () => ({ ok: true })),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AnnouncementsManager", () => {
  it("접근 가능한 Dialog에서 office 공지를 손실 없이 편집하고 Escape로 닫는다", async () => {
    const user = userEvent.setup();
    render(
      <AnnouncementsManager
        items={[
          {
            id: "notice-office",
            title: "운영 회의",
            content: "운영진만 확인",
            audience: "office",
            pinned: false,
            createdAt: "2026-07-16T00:00:00.000Z",
            authorName: "원장",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "관리" }));
    const dialog = await screen.findByRole("dialog", { name: "공지 관리" });
    expect(within(dialog).getAllByText("운영진 (강사 제외)")).toHaveLength(2);
    expect(within(dialog).getByRole("option", { name: "운영진 (강사 제외)" })).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "“운영 회의” 공지 수정" }));
    expect(within(dialog).getByRole("combobox", { name: "공지 대상" })).toHaveValue("office");
    expect(within(dialog).getByRole("textbox", { name: "공지 제목" })).toHaveValue("운영 회의");
    expect(within(dialog).getByRole("textbox", { name: "공지 제목" })).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "공지 관리" })).not.toBeInTheDocument());
  });

  it("행 동작의 대상을 이름으로 구분하고 삭제 취소 시 서버 액션을 호출하지 않는다", async () => {
    const confirmSpy = vi.fn(() => false);
    vi.stubGlobal("confirm", confirmSpy);
    const user = userEvent.setup();
    render(
      <AnnouncementsManager
        items={[
          {
            id: "notice-1",
            title: "시험 일정",
            content: "내용",
            audience: "all",
            pinned: false,
            createdAt: "2026-07-16T00:00:00.000Z",
            authorName: "원장",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "관리" }));
    const dialog = await screen.findByRole("dialog", { name: "공지 관리" });
    expect(within(dialog).getByRole("button", { name: "“시험 일정” 공지 상단 고정" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "“시험 일정” 공지 삭제" }));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(deleteAnnouncement).not.toHaveBeenCalled();
  });
});
