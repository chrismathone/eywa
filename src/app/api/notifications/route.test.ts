import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn(), report: vi.fn() }));
vi.mock("@/features/notifications/server/queries", () => ({ getMyNotifications: mocks.list }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: mocks.report }));

import { GET } from "./route";

const req = (qs = "") => new Request(`https://aywa.example/api/notifications${qs}`);

describe("GET /api/notifications(벨 목록, gotchas #137)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({ unread: 2, items: [] });
  });

  it("받은함이 기본이고, 응답은 캐시하지 않는다", async () => {
    const res = await GET(req());
    expect(mocks.list).toHaveBeenCalledWith("active", undefined);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ unread: 2, items: [] });
  });

  it("보관함·목록 크기를 그대로 넘긴다(크기 상한은 조회 함수가 맞춘다)", async () => {
    await GET(req("?view=archived&limit=40"));
    expect(mocks.list).toHaveBeenCalledWith("archived", 40);
  });

  it("알 수 없는 뷰는 받은함으로", async () => {
    await GET(req("?view=everyone"));
    expect(mocks.list).toHaveBeenCalledWith("active", undefined);
  });

  it("조회가 던지면 500 + 구조화 로그(벨은 조용히 지난 목록을 유지)", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});
