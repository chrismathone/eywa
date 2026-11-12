import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ viewer: vi.fn(), available: vi.fn(), admin: vi.fn(), report: vi.fn() }));
vi.mock("./parent-viewer", () => ({ getParentViewer: m.viewer }));
vi.mock("./parent-availability", () => ({
  PARENT_PORTAL_UNAVAILABLE_MESSAGE: "지금은 이용할 수 있는 화면이 없습니다",
  parentPortalAvailable: m.available,
}));
vi.mock("../../server/access", () => ({ isShuttleAdmin: m.admin }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: m.report }));
vi.mock("./walk-route", () => ({ findWalkRoute: vi.fn() }));

import { searchNearbyPlace, walkRoutesFrom } from "./nearby-actions";

const near = { lat: 35.87, lng: 128.6 };
const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchSpy);
  m.viewer.mockResolvedValue(null);
  m.admin.mockResolvedValue(false);
});

describe("가까운 노선 액션 — 판정이 외부 지도 호출보다 먼저", () => {
  it("학부모 포털이 닫힌 지점의 학부모는 학부모 안내로 거절되고 외부 API를 부르지 않는다", async () => {
    m.viewer.mockResolvedValue({ tenantId: "t1" });
    m.available.mockResolvedValue(false);
    await expect(searchNearbyPlace("정류장", near)).resolves.toEqual({ error: "지금은 이용할 수 있는 화면이 없습니다" });
    await expect(walkRoutesFrom(near, [{ id: "s1", ...near }])).resolves.toEqual({ error: "지금은 이용할 수 있는 화면이 없습니다" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("학부모도 셔틀 관리자도 아니면 종전 문구('로그인이 필요합니다')로 거절한다 — 직원에게 학부모 안내를 보이지 않는다", async () => {
    await expect(searchNearbyPlace("정류장", near)).resolves.toEqual({ error: "로그인이 필요합니다" });
    await expect(walkRoutesFrom(near, [{ id: "s1", ...near }])).resolves.toEqual({ error: "로그인이 필요합니다" });
    expect(m.available).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("셔틀 관리자(직원)는 학부모 판정을 타지 않는다", async () => {
    m.admin.mockResolvedValue(true);
    await expect(searchNearbyPlace("   ", near)).resolves.toEqual({ hits: [] });
    expect(m.available).not.toHaveBeenCalled();
  });
});
