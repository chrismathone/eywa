import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FolderBreadcrumbs, type FolderCrumb } from "./folder-breadcrumbs";

const path: FolderCrumb[] = ["수업", "수학", "중등", "시험지", "1학년"].map((label, i) => ({ key: `folder-${i}`, label, href: `/documents?cat=folder-${i}&embed=1` }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("긴 경로 가운데를 생략하고 메뉴에서 생략된 모든 상위 폴더로 이동할 수 있다", async () => {
  const user = userEvent.setup();
  render(<FolderBreadcrumbs path={path} rootHref="/documents?embed=1" />);
  const nav = screen.getByRole("navigation", { name: "현재 폴더 경로" });
  expect(within(nav).getAllByRole("link").map((el) => el.textContent)).toEqual(["전체 문서", "시험지", "1학년"]);
  expect(screen.getByRole("link", { name: "시험지" })).toHaveAttribute("href", path[3].href);
  expect(screen.getByRole("link", { name: "1학년" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: "생략된 상위 폴더 보기" }));
  const menu = await screen.findByRole("menu");
  expect(within(menu).getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["수업", "수업 / 수학", "수업 / 수학 / 중등"]);
  expect(within(menu).getByRole("menuitem", { name: "수업 / 수학" })).toHaveAttribute("href", path[1].href);
});

it("사용 가능한 폭에 맞춰 가운데 경로를 줄였다가 창이 넓어지면 다시 펼친다", () => {
  let resize: () => void = () => {};
  vi.stubGlobal("ResizeObserver", class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} });
  let width = 240;
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ width: 60 } as DOMRect);
  render(<FolderBreadcrumbs path={path.slice(0, 3)} rootHref="/documents" />);
  const nav = screen.getByRole("navigation");
  act(() => resize());
  expect(within(nav).getAllByRole("link")).toHaveLength(4);
  width = 180;
  act(() => resize());
  expect(within(nav).getAllByRole("link").map((el) => el.textContent)).toEqual(["전체 문서", "중등"]);
  width = 400;
  act(() => resize());
  expect(within(nav).getAllByRole("link")).toHaveLength(4);
  expect(screen.queryByRole("button", { name: "생략된 상위 폴더 보기" })).not.toBeInTheDocument();
});
