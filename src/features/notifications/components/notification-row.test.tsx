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
