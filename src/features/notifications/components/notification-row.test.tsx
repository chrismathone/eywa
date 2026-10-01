import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NotificationRow } from "./notification-row";

afterEach(cleanup);
it("열기·보관·삭제를 독립된 버튼으로 제공해 보관 시 상세 화면이 열리지 않는다", () => {
  const onOpen = vi.fn(),
    onArchive = vi.fn(),
    onDelete = vi.fn();
  const { container } = render(
    <NotificationRow
      item={{
        id: "n1",
        type: "absence_alert",
        title: "반복 결석 학생",
        body: "김지우 학생 · 최근 14일 결석 3회",
        link: "/dashboard#repeated-absences",
        read: false,
        createdAt: "2026-09-11T00:00:00Z",
      }}
      archived={false}
      onOpen={onOpen}
      onArchive={onArchive}
      onDelete={onDelete}
    />,
  );
  expect(container.querySelector("button button")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "반복 결석 학생 보관" }));
  expect(onArchive).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "반복 결석 학생 삭제" }));
  expect(onDelete).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: /반복 결석 학생 안 읽음 김지우/ }),
  );
  expect(onOpen).toHaveBeenCalledOnce();
});
it("학부모 글 알림 — 답글이 없으면 '답글 쓰기', 이미 달았으면 '답글 N'으로 쓰레드에 다시 들어간다", () => {
  const onReply = vi.fn();
  const item = { id: "n2", type: "classnote_parent_comment", title: "홍길동 학부모 댓글", body: "[영상] (내용 없이 첨부만)", link: "https://www.classnote.com/service/report/1?comment=2", read: true, createdAt: "2026-10-01T00:00:00Z" };
  const { rerender } = render(<NotificationRow item={item} archived={false} onOpen={() => {}} onArchive={() => {}} onDelete={() => {}} onReply={onReply} />);
  expect(screen.getByRole("button", { name: "답글 쓰기" })).toBeTruthy();
  rerender(<NotificationRow item={item} archived={false} onOpen={() => {}} onArchive={() => {}} onDelete={() => {}} onReply={onReply} replyCount={2} />);
  fireEvent.click(screen.getByRole("button", { name: "답글 2" }));
  expect(onReply).toHaveBeenCalledOnce();
});
