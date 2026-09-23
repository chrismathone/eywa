import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DocumentCategoryOption } from "@/features/documents/categories";

const mocks = vi.hoisted(() => ({ create: vi.fn(), reparent: vi.fn(), rename: vi.fn(), reorder: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/documents/server/category-actions", () => ({
  createDocumentCategory: mocks.create, reparentDocumentCategory: mocks.reparent,
  renameDocumentCategory: mocks.rename, moveDocumentCategory: mocks.reorder, deleteDocumentCategory: mocks.remove,
}));
import { CategoryManager, NewFolderButton } from "./category-manager";
import { FolderTree } from "./folder-tree";

const categories: DocumentCategoryOption[] = [
  { key: "class", label: "수업", isSystem: true },
  { key: "other", label: "기타", isSystem: true },
  { key: "middle", label: "중등", isSystem: false, parentKey: "class" },
  { key: "leaf", label: "시험지", isSystem: false, parentKey: "middle" },
  { key: "sibling", label: "고등", isSystem: false, parentKey: "class" },
];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

it("현재 폴더 아래에 새 폴더를 생성하고 실패하면 입력을 보존한다", async () => {
  const user = userEvent.setup();
  mocks.create.mockResolvedValueOnce({ error: "같은 이름이 있습니다" }).mockResolvedValueOnce({ ok: true, key: "new" });
  render(<NewFolderButton categories={categories} parentKey="leaf" />);
  await user.click(screen.getByRole("button", { name: "하위 폴더 만들기" }));
  expect(screen.getByLabelText("상위 폴더")).toHaveValue("leaf");
  await user.type(screen.getByLabelText("새 폴더 이름"), "2026년");
  await user.click(screen.getByRole("button", { name: "폴더 만들기" }));
  expect(await screen.findByText("같은 이름이 있습니다")).toBeInTheDocument();
  expect(screen.getByLabelText("새 폴더 이름")).toHaveValue("2026년");
  const form = mocks.create.mock.calls[0][1] as FormData;
  expect(form.get("parentKey")).toBe("leaf");
  expect(form.get("label")).toBe("2026년");
  const retry = await screen.findByRole("button", { name: "폴더 만들기" });
  await waitFor(() => expect(retry).toBeEnabled());
  await user.click(retry);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("하위 폴더가 있는 폴더의 삭제를 막고, 이동 목적지에서 자신과 후손을 제외한다", async () => {
  const user = userEvent.setup();
  mocks.reparent.mockResolvedValue({ ok: true });
  render(<CategoryManager categories={categories} counts={{ leaf: 4 }} />);
  await user.click(screen.getByRole("button", { name: "폴더 관리" }));
  expect(screen.getByRole("button", { name: "수업 / 중등: 하위 폴더를 먼저 옮겨 주세요" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "수업 / 중등 위로" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "수업 / 중등 아래로" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "수업 / 중등 이동" }));
  const select = screen.getByLabelText("이동할 상위 폴더");
  expect(within(select).queryByRole("option", { name: "수업 / 중등" })).not.toBeInTheDocument();
  expect(within(select).queryByRole("option", { name: "수업 / 중등 / 시험지" })).not.toBeInTheDocument();
  await user.selectOptions(select, "other");
  await user.click(screen.getByRole("button", { name: "폴더 이동" }));
  await waitFor(() => expect(mocks.reparent).toHaveBeenCalledWith("middle", "other"));
});

it("문서가 없는 폴더 삭제에도 문서 이동 위치를 명시한다", async () => {
  const user = userEvent.setup();
  mocks.remove.mockResolvedValue({ error: "새 하위 폴더가 생겼습니다" });
  render(<CategoryManager categories={categories} counts={{}} />);
  await user.click(screen.getByRole("button", { name: "폴더 관리" }));
  await user.click(screen.getByRole("button", { name: "수업 / 중등 / 시험지 삭제" }));
  await user.selectOptions(screen.getByLabelText("문서를 옮길 폴더"), "sibling");
  await user.click(screen.getByRole("button", { name: "옮기고 삭제" }));
  await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("leaf", "sibling"));
  expect(await screen.findByText("새 하위 폴더가 생겼습니다")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

it("접힌 트리를 단계별로 펼치고 직접 진입한 깊은 폴더의 경로를 노출한다", async () => {
  const user = userEvent.setup();
  const hrefs = Object.fromEntries(categories.map((c) => [c.key, `/documents?cat=${c.key}&embed=1`]));
  const view = render(<FolderTree categories={categories} counts={{ class: 4, middle: 4, leaf: 4 }} activeKey={null} hrefs={hrefs} favoriteKeys={[]} />);
  expect(screen.queryByRole("link", { name: /중등/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "수업 펼치기" }));
  await user.click(screen.getByRole("button", { name: "수업 / 중등 펼치기" }));
  expect(screen.getByRole("link", { name: /시험지/ })).toHaveAttribute("href", hrefs.leaf);
  await user.click(screen.getByRole("button", { name: "수업 접기" }));
  expect(screen.queryByRole("link", { name: /시험지/ })).not.toBeInTheDocument();
  view.rerender(<FolderTree categories={categories} counts={{ leaf: 4 }} activeKey="leaf" hrefs={hrefs} favoriteKeys={[]} />);
  expect(screen.getByRole("link", { name: /시험지/ })).toHaveAttribute("aria-current", "page");
});
