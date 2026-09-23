import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ move: vi.fn(), moveFile: vi.fn(), upload: vi.fn(), refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/features/documents/server/category-actions", () => ({ reparentDocumentCategory: mocks.move, renameDocumentCategory: vi.fn() }));
vi.mock("@/features/documents/server/file-actions", () => ({ moveDocumentFile: mocks.moveFile, renameDocumentFile: vi.fn() }));
vi.mock("@/features/documents/server/actions", () => ({ deleteDocument: vi.fn(), toggleDocumentPin: vi.fn() }));
vi.mock("@/features/documents/open-file", () => ({ downloadDocument: vi.fn() }));
vi.mock("@/features/documents/upload-file", () => ({ uploadDocumentFile: mocks.upload }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mocks.error } }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
import { FolderInteractionProvider, FolderDropTarget } from "./folder-interactions";
import { DocumentRow } from "./document-row";
import { DirectFileDrop } from "./direct-file-drop";
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
    <table><tbody><DocumentRow canWrite={canManage} doc={{ id: "file", title: "시험지.pdf", fileName: "시험지.pdf", kind: "file", category: "child", categoryLabel: "시험지", typeLabel: "PDF", sizeLabel: "1KB", createdAt: "2026-09-23", uploaderName: null, pinned: false, description: null, href: "/documents/file/preview" }} /></tbody></table>
    <DirectFileDrop category="child" folderLabel="시험지" dialogOpen={false} blocked={false} />
  </FolderInteractionProvider>);
  const dataTransfer = { types: [] as string[], effectAllowed: "", dropEffect: "", clearData() { this.types.splice(0); }, setData(type: string) { this.types.push(type); } };
  const target = (key: string) => view.container.querySelector(`[data-folder-key="${key}"]`)!;
  const drag = (from: string, to: string) => { fireEvent.dragStart(target(from), { dataTransfer }); fireEvent.dragOver(target(to), { dataTransfer }); fireEvent.drop(target(to), { dataTransfer }); };
  const file = view.container.querySelector("[data-document-id=file]")!;
  const dragFile = (to: string) => { fireEvent.dragStart(file, { dataTransfer }); fireEvent.dragOver(target(to), { dataTransfer }); fireEvent.drop(target(to), { dataTransfer }); };
  return { drag, dragFile, file, target, dataTransfer };
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
  expect(mocks.moveFile).not.toHaveBeenCalled();
});

it("파일을 하위·다른 폴더로 이동하고 외부 업로드나 폴더 이동을 호출하지 않는다", async () => {
  mocks.moveFile.mockResolvedValue({ ok: true });
  const { dragFile } = setup();
  dragFile("leaf");
  await waitFor(() => expect(mocks.moveFile).toHaveBeenCalledWith("file", "leaf", "child"));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  expect(mocks.move).not.toHaveBeenCalled();
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("같은 폴더·전체 문서·읽기 전용·다른 창에서 온 파일 드래그는 이동하지 않는다", () => {
  const { dragFile, target } = setup();
  fireEvent.drop(target("other"), { dataTransfer: { types: ["application/x-aywa-document-file"] } });
  dragFile("child"); dragFile("__root");
  expect(mocks.moveFile).not.toHaveBeenCalled();
  cleanup();
  const readonly = setup(false);
  expect(readonly.file).toHaveAttribute("draggable", "false");
  readonly.dragFile("other");
  expect(mocks.moveFile).not.toHaveBeenCalled();
});

it("이름을 편집하거나 삭제를 확인하는 동안에는 파일을 끌어 이동하지 않는다", () => {
  const { dragFile } = setup();
  fireEvent.doubleClick(screen.getByRole("link", { name: "시험지.pdf" }));
  expect(screen.getByRole("textbox")).toBeInTheDocument();
  dragFile("other");
  expect(mocks.moveFile).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "시험지.pdf 삭제" }));
  dragFile("other");
  expect(mocks.moveFile).not.toHaveBeenCalled();
});

it("저장 중 중복 드롭을 막고 실패하면 오류를 알린 뒤 다시 이동할 수 있다", async () => {
  let finish!: (value: { error: string }) => void;
  mocks.moveFile.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { dragFile, file } = setup();
  dragFile("other"); dragFile("leaf");
  expect(mocks.moveFile).toHaveBeenCalledTimes(1);
  expect(file).toHaveAttribute("draggable", "false");
  await act(async () => finish({ error: "폴더가 삭제되었습니다" }));
  expect(mocks.error).toHaveBeenCalledWith("폴더가 삭제되었습니다");
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.moveFile.mockResolvedValueOnce({ ok: true });
  dragFile("leaf");
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
});
