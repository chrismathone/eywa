import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { InlineRename } from "./inline-rename";
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.useRealTimers(); });

it("단일 클릭은 열고 더블클릭은 열지 않고 이름을 편집한다", () => {
  vi.useFakeTimers();
  const open = vi.fn((e) => e.preventDefault());
  render(<InlineRename enabled name="시험지" suffix=".pdf" maxLength={180} onSave={vi.fn()}><a href="/file" onClick={open}>시험지.pdf</a></InlineRename>);
  const link = screen.getByRole("link");
  fireEvent.click(link, { detail: 1 });
  expect(open).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(501));
  expect(open).toHaveBeenCalledOnce();
  open.mockClear();
  fireEvent.click(link, { detail: 1 });
  fireEvent.click(link, { detail: 2 });
  fireEvent.doubleClick(link);
  act(() => vi.advanceTimersByTime(501));
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "새 이름" })).toHaveValue("시험지");
  expect(screen.getByText(".pdf")).toBeInTheDocument();
});

it("Enter 저장·Esc 취소·한글 조합 중 Enter를 구분하고 확장자를 입력에서 분리한다", async () => {
  const save = vi.fn().mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<InlineRename enabled name="시험지" suffix=".PDF" maxLength={180} onSave={save}><a href="#">시험지.PDF</a></InlineRename>);
  await user.dblClick(screen.getByRole("link"));
  const input = screen.getByRole("textbox");
  await user.clear(input); await user.type(input, "수정한 시험지");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true, keyCode: 229 });
  expect(save).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(save).toHaveBeenCalledWith("수정한 시험지"));
  await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
  await user.dblClick(screen.getByRole("link"));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(save).toHaveBeenCalledOnce();
});

it("실패 시 편집값을 유지하고 읽기 전용에는 편집 입력을 열지 않는다", async () => {
  const user = userEvent.setup();
  const save = vi.fn().mockResolvedValue({ error: "같은 이름이 있습니다" });
  const view = render(<InlineRename enabled name="폴더" maxLength={20} onSave={save}><a href="#">폴더</a></InlineRename>);
  await user.dblClick(screen.getByRole("link"));
  await user.clear(screen.getByRole("textbox")); await user.type(screen.getByRole("textbox"), "새 폴더");
  await user.click(screen.getByRole("button", { name: "이름 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("같은 이름이 있습니다");
  expect(screen.getByRole("textbox")).toHaveValue("새 폴더");
  view.unmount();
  render(<InlineRename enabled={false} name="폴더" maxLength={20} onSave={save}><a href="#">폴더</a></InlineRename>);
  await user.dblClick(screen.getByRole("link"));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
