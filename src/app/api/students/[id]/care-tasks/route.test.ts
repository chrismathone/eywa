import { beforeEach, describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({ tasks: vi.fn() }));
vi.mock("@/features/student-care/server/tasks", () => ({ getCareTasks: h.tasks }));
import { GET } from "./route";
const read = (filter = "open") => GET(new Request(`https://example.test/api/students/example/care-tasks?filter=${filter}`),
  { params: Promise.resolve({ id: "example" }) });
beforeEach(() => vi.clearAllMocks());
describe("학생 관련 업무 응답", () => {
  it("사용자별 자료를 공유 캐시에 저장하지 않는다", async () => {
    h.tasks.mockResolvedValue({ items: [], total: 0, canMonitor: false });
    const res = await read();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("권한 없음은 존재 여부를 구분하지 않는 응답이다", async () => {
    h.tasks.mockResolvedValue(null);
    expect((await read()).status).toBe(404);
  });
  it("스키마·원본 장애는 실패로 표시하고 DB 오류를 내보내지 않는다", async () => {
    h.tasks.mockRejectedValue(new Error("private database content"));
    const res = await read();
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("private database content");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("알 수 없는 필터는 조회 전에 거절한다", async () => {
    expect((await read("unexpected")).status).toBe(400);
    expect(h.tasks).not.toHaveBeenCalled();
  });
});
