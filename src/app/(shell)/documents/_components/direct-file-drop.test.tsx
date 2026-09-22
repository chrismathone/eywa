import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), refresh: vi.fn() }));
const router = { refresh: mocks.refresh };
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/documents/upload-file", () => ({ uploadDocumentFile: mocks.upload }));
import { DirectFileDrop } from "./direct-file-drop";
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const drop = (files: File[]) => fireEvent.drop(window, { dataTransfer: { types: ["Files"], files } });

it("여러 파일을 드롭 시점 폴더에 순서대로 저장하고 실패가 있어도 다음 파일을 처리한다", async () => {
  let finish: () => void = () => {};
  mocks.upload.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
    .mockRejectedValueOnce(new Error("실패한 파일"))
    .mockResolvedValueOnce(undefined);
  const view = render(<DirectFileDrop category="folder-a" folderLabel="수업 / A" dialogOpen={false} blocked={false} />);
  const files = ["하나.pdf", "둘.pdf", "셋.pdf"].map((name) => new File(["pdf"], name));
  drop(files);
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  view.rerender(<DirectFileDrop category="folder-b" folderLabel="수업 / B" dialogOpen={false} blocked={false} />);
  await act(async () => finish());
  await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
  expect(mocks.upload.mock.calls.map((call) => call[1])).toEqual(["folder-a", "folder-a", "folder-a"]);
  expect(await screen.findByRole("alert")).toHaveTextContent("실패한 파일");
  expect(screen.getByRole("status")).toHaveTextContent("2/3개 완료");
});

it("연동 폴더·열린 다이얼로그·앱 내부 폴더 드래그는 직접 업로드하지 않는다", () => {
  const file = new File(["pdf"], "파일.pdf");
  const view = render(<DirectFileDrop category="other" folderLabel="기타" dialogOpen={false} blocked />);
  drop([file]);
  view.rerender(<DirectFileDrop category="class" folderLabel="수업" dialogOpen blocked={false} />);
  drop([file]);
  fireEvent.drop(window, { dataTransfer: { types: ["application/x-aywa-document-folder"], files: [] } });
  expect(mocks.upload).not.toHaveBeenCalled();
});
