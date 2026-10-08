// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/video-submit/server/upload-diagnostics", () => ({ recordUploadEvent: m.record }));
import { POST } from "./route";
beforeEach(() => { m.record.mockReset().mockResolvedValue(204); });
const request = (body: string, origin = "https://www.aywa.co.kr") => new Request("https://www.aywa.co.kr/api/video-submit/event", { method: "POST", headers: { origin, "content-type": "application/json" }, body });
it("다른 출처, 큰 본문, 깨진 JSON은 DB에 도달하지 않는다", async () => {
  expect((await POST(request("{}", "https://evil.example"))).status).toBe(403);
  expect((await POST(request("x".repeat(4097)))).status).toBe(413);
  expect((await POST(request("{"))).status).toBe(400);
  expect(m.record).not.toHaveBeenCalled();
});
it("관측값 기록의 HTTP 상태를 그대로 돌려주고 캐시하지 않는다", async () => {
  m.record.mockResolvedValue(429);
  const response = await POST(request(JSON.stringify({ token: "t", uploadId: "id", event: {} })));
  expect(response.status).toBe(429); expect(response.headers.get("cache-control")).toBe("no-store");
});
