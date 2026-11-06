import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), popups: vi.fn(), report: vi.fn(), viewAs: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/view-as", () => ({ viewAsTeacher: mocks.viewAs }));
vi.mock("@/features/notices/server/queries", () => ({ getActivePopupsOrThrow: mocks.popups }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: mocks.report }));

import { GET } from "./route";

describe("GET /api/notice-popups(열린 셸의 팝업 재조회, gotchas #137)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "u1", tenantId: "t1", systemRole: "teacher" });
    mocks.popups.mockResolvedValue([{ id: "p1" }]);
    mocks.viewAs.mockResolvedValue(null);
  });

  it("셸과 같은 판정 함수를 로그인한 사람의 역할·지점·계정으로 부르고, 캐시하지 않는다", async () => {
    const res = await GET();
    expect(mocks.popups).toHaveBeenCalledWith("teacher", "t1", "u1");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ popups: [{ id: "p1" }] });
  });

  it("'다른 강사 뷰'면 그 강사 역할 대상 팝업 — '다시 보지 않기'는 보는 사람 본인 계정(대신 닫아 준 공지가 그 강사 화면에서 사라지면 안 된다)", async () => {
    mocks.user.mockResolvedValue({ id: "admin1", tenantId: "t1", systemRole: "admin" });
    mocks.viewAs.mockResolvedValue({ id: "kim", tenantId: "t1", systemRole: "teacher", access: "full" });
    await GET();
    expect(mocks.popups).toHaveBeenCalledWith("teacher", "t1", "admin1");
  });

  it("로그인을 못 읽으면 401 — 빈 목록으로 답하지 않는다(화면이 보던 카드를 내리지 않게)", async () => {
    mocks.user.mockResolvedValue(null);
    const res = await GET();
    expect(mocks.popups).not.toHaveBeenCalled();
    expect(res.status).toBe(401);
  });

  it("실패는 500 + 로그 — 화면은 보던 목록을 유지한다", async () => {
    mocks.popups.mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledWith(expect.any(Error), { scope: "api.notice-popups.list" });
  });
});
