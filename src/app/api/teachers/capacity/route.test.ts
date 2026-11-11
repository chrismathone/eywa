// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/features/teacher-hub/server", () => ({ saveTeacherCapacity: mock.save, TeacherHubError: class extends Error { constructor(message: string, public status = 400) { super(message); } } }));
import { POST } from "./route";
const req = (body: string, origin = "https://www.aywa.co.kr") => new Request("https://www.aywa.co.kr/api/teachers/capacity", { method: "POST", headers: { origin }, body });
beforeEach(() => vi.clearAllMocks());
it("cross-origin 변경 요청은 저장 전에 거절한다", async () => {
  expect((await POST(req("{}", "https://elsewhere.test"))).status).toBe(403);
  expect(mock.save).not.toHaveBeenCalled();
});
it("깨진 본문은 400 · 서버 오류 원문은 내보내지 않는다", async () => {
  expect((await POST(req("{"))).status).toBe(400);
  mock.save.mockRejectedValue(Error("private server credentials"));
  const res = await POST(req("{}"));
  expect(res.status).toBe(500);
  expect(await res.text()).not.toContain("credentials");
});
it("저장 결과를 no-store로 돌려준다", async () => {
  mock.save.mockResolvedValue({ version: 1, month: "2026-11" });
  const res = await POST(req("{}"));
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ saved: { version: 1, month: "2026-11" } });
});
