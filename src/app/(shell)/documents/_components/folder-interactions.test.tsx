import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ move: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/documents/server/category-actions", () => ({ reparentDocumentCategory: mocks.move, renameDocumentCategory: vi.fn() }));
import { FolderInteractionProvider, FolderDropTarget } from "./folder-interactions";
const categories = [
  { key: "root", label: "수업", isSystem: true },
  { key: "other", label: "기타", isSystem: true },
  { key: "child", label: "시험지", isSystem: false, parentKey: "root" },
  { key: "leaf", label: "1학년", isSystem: false, parentKey: "child" },
];
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function setup(canManage = true) {
  const view = render(<FolderInteractionProvider categories={categories} canManage={canManage}>
    {[null, ...categories.map((c) => c.key)].map((key) => <FolderDropTarget key={key ?? "__root"} folderKey={key}><span>{key ?? "전체 문서"}</span></FolderDropTarget>)}
  </FolderInteractionProvider>);
  const dataTransfer = { types: [] as string[], effectAllowed: "", dropEffect: "", setData(type: string) { this.types.push(type); } };
  const target = (key: string) => view.container.querySelector(`[data-folder-key="${key}"]`)!;
  const drag = (from: string, to: string) => { fireEvent.dragStart(target(from), { dataTransfer }); fireEvent.dragOver(target(to), { dataTransfer }); fireEvent.drop(target(to), { dataTransfer }); };
  return { drag, target, dataTransfer };
}
it("다른 폴더에 놓으면 그 폴더의 하위로, 전체 문서에 놓으면 최상위로 이동한다", async () => {
  mocks.move.mockResolvedValue({ ok: true });
  const { drag } = setup();
  drag("child", "other");
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith("child", "other"));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  drag("leaf", "__root");
  await waitFor(() => expect(mocks.move).toHaveBeenCalledWith("leaf", null));
});
it("자신·후손·현재 부모 및 읽기 전용 드롭은 서버에 보내지 않는다", () => {
  const { drag } = setup();
  drag("child", "child"); drag("child", "leaf"); drag("child", "root");
  expect(mocks.move).not.toHaveBeenCalled();
  cleanup();
  setup(false).drag("child", "other");
  expect(mocks.move).not.toHaveBeenCalled();
});
it("외부 파일 드롭은 폴더 이동으로 해석하지 않는다", () => {
  const { target } = setup();
  fireEvent.drop(target("other"), { dataTransfer: { types: ["Files"], files: [] } });
  expect(mocks.move).not.toHaveBeenCalled();
});
