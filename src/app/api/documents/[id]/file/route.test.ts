// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ access: vi.fn(), sign: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/auth/api-access", () => ({ apiAccess: mocks.access }));
vi.mock("@/features/documents/server/actions", () => ({ signDocumentUrl: mocks.sign }));
import { GET } from "./route";
const name = "10월 수업 양식 (최종).PDF";
const request = (query = "") => GET(new Request(`https://app.test/api/documents/doc/file${query}`), { params: Promise.resolve({ id: "doc" }) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ ok: true });
  mocks.sign.mockResolvedValue({ url: "https://storage.test/uuid.pdf?token=secret", fileName: name });
  mocks.fetch.mockImplementation(async () => new Response("%PDF-bytes", { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=uuid.pdf" } }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => vi.unstubAllGlobals());
it.each([["?download=1", "attachment"], ["", "inline"]])("%s에서 원본 한글 파일명과 확장자를 보존한다", async (query, disposition) => {
  const res = await request(query);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toMatch(new RegExp(`^${disposition};`));
  expect(decodeURIComponent(res.headers.get("content-disposition")!.split("filename*=UTF-8''")[1]!)).toBe(name);
  expect(res.headers.get("content-disposition")).not.toContain("uuid");
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(await res.text()).toBe("%PDF-bytes");
});
it("로그인·접근 권한이 없거나 문서 조회가 거절되면 저장소에 접근하지 않는다", async () => {
  mocks.access.mockResolvedValueOnce({ ok: false, status: 401 });
  expect((await request()).status).toBe(401);
  expect(mocks.sign).not.toHaveBeenCalled();
  mocks.sign.mockResolvedValueOnce({ error: "접근 불가" });
  expect((await request()).status).toBe(404);
  expect(mocks.fetch).not.toHaveBeenCalled();
});
it("저장소 오류 응답을 파일로 내보내지 않는다", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response("expired", { status: 403 }));
  expect((await request()).status).toBe(502);
});
it("실행 가능한 형식은 앱 출처에서 미리보기하지 않고 내려받는다", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
  expect((await request()).headers.get("content-disposition")).toMatch(/^attachment;/);
});
