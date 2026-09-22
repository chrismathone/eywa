import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ ticket: vi.fn(), upload: vi.fn(), register: vi.fn() }));
vi.mock("./server/actions", () => ({ issueDocumentUploadTicket: mocks.ticket, registerUploadedDocument: mocks.register }));
vi.mock("@/lib/storage/upload-to-ticket", () => ({ uploadToTicket: mocks.upload }));
import { uploadDocumentFile } from "./upload-file";
beforeEach(() => {
  vi.clearAllMocks(); mocks.ticket.mockResolvedValue({ ticket: { path: "tenant/documents/file.pdf" } });
  mocks.upload.mockResolvedValue(undefined); mocks.register.mockResolvedValue({ ok: true });
});
it("드롭 파일명과 선택 폴더를 그대로 등록한다", async () => {
  const file = new File(["pdf"], "2026 시험지.v2.PDF", { type: "application/pdf" });
  await uploadDocumentFile(file, "nested-folder");
  const data = mocks.register.mock.calls[0][1] as FormData;
  expect(data.get("title")).toBe(file.name); expect(data.get("fileName")).toBe(file.name);
  expect(data.get("category")).toBe("nested-folder");
});
it("저장 실패 시 등록하지 않고, 등록 실패도 성공으로 처리하지 않는다", async () => {
  const file = new File(["pdf"], "시험지.pdf");
  mocks.upload.mockRejectedValueOnce(new Error("저장 실패"));
  await expect(uploadDocumentFile(file, "class")).rejects.toThrow("저장 실패");
  expect(mocks.register).not.toHaveBeenCalled();
  mocks.register.mockResolvedValueOnce({ error: "폴더가 삭제되었습니다" });
  await expect(uploadDocumentFile(file, "class")).rejects.toThrow("폴더가 삭제되었습니다");
});
