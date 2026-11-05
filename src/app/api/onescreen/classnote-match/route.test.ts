import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  view: vi.fn(),
  version: vi.fn(),
  load: vi.fn(),
  report: vi.fn(),
}));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/view-mode", () => ({ getShellView: mocks.view }));
vi.mock("@/features/onescreen/server/classnote-match", () => ({
  getClassnoteMatchVersion: mocks.version,
  loadClassnoteMatch: mocks.load,
}));
vi.mock("@/lib/observability/report-error", () => ({ reportError: mocks.report }));

import { GET } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const C = "33333333-3333-4333-8333-333333333333";
const req = (qs: string) => new Request(`https://aywa.example/api/onescreen/classnote-match?${qs}`);

describe("GET /api/onescreen/classnote-match(C.N 아이콘 새로고침 없는 갱신)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "t1", tenantId: "tn" });
    mocks.view.mockResolvedValue("teacher");
    mocks.version.mockResolvedValue("v2");
  });

  it("로그인 안 됨 = 401 · 강사 화면이 아니면 403(페이지와 같은 게이트) — 조회하지 않는다", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(req(`classes=${A}`))).status).toBe(401);
    mocks.view.mockResolvedValueOnce("admin");
    expect((await GET(req(`classes=${A}`))).status).toBe(403);
    expect(mocks.version).not.toHaveBeenCalled();
  });

  it("🔴 버전이 같으면 버전만 — 전체 조회를 하지 않는다(가벼운 확인)", async () => {
    const res = await GET(req(`date=2026-11-04&classes=${A}&known=v2`));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ version: "v2" });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("🔴 버전이 다르면 그 날짜로 읽어 화면의 반 몫만(페이지와 같은 pickCnForRoster) 준다", async () => {
    mocks.load.mockResolvedValue({
      map: {
        available: true,
        byKey: { [`${A}|s1`]: { status: "ok", boardName: "A반", childNames: [], reasons: [] }, [`${C}|s9`]: { status: "hold", boardName: null, childNames: [], reasons: ["남의 반"] } },
        okBoards: { s1: [{ classId: A, boardName: "A반" }], s9: [{ classId: C, boardName: "C반" }] },
        eligibleClassIds: [A, C],
        version: "v2",
      },
      attending: [{ class_id: A, student_id: "s1" }, { class_id: C, student_id: "s9" }],
    });
    const res = await GET(req(`date=2026-11-03&classes=${A}&known=v1`));
    expect(mocks.load).toHaveBeenCalledWith("2026-11-03");
    const body = await res.json();
    expect(body.version).toBe("v2");
    expect(Object.keys(body.map.byKey)).toEqual([`${A}|s1`]);
    expect(body.map.eligibleClassIds).toEqual([A]);
    expect(JSON.stringify(body)).not.toContain("남의 반");
    expect(JSON.stringify(body)).not.toContain("attending");
  });

  it("🔴 전체 조회가 실패하면 지도를 주지 않는다 — 일시 오류로 화면의 아이콘이 통째로 사라지지 않게", async () => {
    mocks.load.mockResolvedValue({ map: { available: false, byKey: {}, eligibleClassIds: [] }, attending: [] });
    expect(await (await GET(req(`classes=${A}&known=v1`))).json()).toEqual({ version: null });
    mocks.version.mockResolvedValueOnce(null);
    expect(await (await GET(req(`classes=${A}&known=v1`))).json()).toEqual({ version: null });
  });

  it("던지면 500 + 구조화 로그(화면은 지난 값 그대로)", async () => {
    mocks.version.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req(`classes=${A}`));
    expect(res.status).toBe(500);
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});
