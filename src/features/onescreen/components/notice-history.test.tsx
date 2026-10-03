import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NoticeHistory, NoticeHistoryItem } from "./notice-history";

afterEach(cleanup);
const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `공지 ${i + 1}` }));
const history = (data = rows) => <NoticeHistory title="내가 보낸 공지" empty="없음" rows={data}>
  {row => <NoticeHistoryItem title={row.title} status="게시 완료"><p>전체 본문 {row.id}</p><button>수정 {row.id}</button></NoticeHistoryItem>}
</NoticeHistory>;

it("긴 이력은 5건씩 나누고 뒤 페이지까지 모든 항목을 볼 수 있다", () => {
  const { container, rerender } = render(history());
  expect(container.querySelectorAll("details")).toHaveLength(5);
  expect(container.querySelector("details")?.open).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "다음 공지 목록" }));
  expect(screen.queryByText("공지 1")).toBeNull();
  expect(screen.getByText("공지 6")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "다음 공지 목록" }));
  expect(container.querySelectorAll("details")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "다음 공지 목록" }).hasAttribute("disabled")).toBe(true);
  // 삭제/새로고침으로 목록이 줄어도 빈 페이지에 갇히지 않는다.
  rerender(history(rows.slice(0, 3)));
  expect(screen.getByText("공지 1")).toBeTruthy();
  expect(container.querySelectorAll("details")).toHaveLength(3);
});

it("펼칠 본문과 수정 동작은 유지하며 빈 이력을 안내한다", () => {
  const { container, rerender } = render(history());
  const detail = container.querySelector("details")!;
  detail.open = true;
  expect(screen.getByRole("button", { name: "수정 0" })).toBeTruthy();
  expect(screen.getByText("전체 본문 0")).toBeTruthy();
  rerender(history([]));
  expect(screen.getByText("없음")).toBeTruthy();
  expect(container.querySelector("details")).toBeNull();
});
