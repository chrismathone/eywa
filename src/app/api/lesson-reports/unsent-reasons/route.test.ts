import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), load: vi.fn(), report: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: mocks.access }));
vi.mock("@/features/report-admin/server/unsent-reasons", () => ({ loadUnsentReasonCards: mocks.load, UNSENT_REASON_MAX: 60 }));
vi.mock("@/lib/observability/report-error", () => ({ reportError: mocks.report }));

import { GET } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const req = (qs: string) => new Request(`https://aywa.example/api/lesson-reports/unsent-reasons?${qs}`);

describe("GET /api/lesson-reports/unsent-reasons(보고서 목록 '미발송' 칸 카드)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "u1", tenantId: "tn", systemRole: "admin" });
    mocks.access.mockResolvedValue(true);
    mocks.load.mockResolvedValue({ [A]: { title: "아직 안 나간 이유", lines: ["선생님이 아직 발송을 누르지 않았습니다"] } });
  });

  it("🔴 권한은 목록과 같다 — 로그인 안 됨 401 · 보고서 관리 권한 없음 403(조회하지 않는다)", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await GET(req(`ids=${A}`))).status).toBe(401);
    mocks.access.mockResolvedValueOnce(false);
    expect((await GET(req(`ids=${A}`))).status).toBe(403);
    expect(mocks.access).toHaveBeenCalledWith("admin", "lesson_reports");
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("주소의 id는 모양을 거르고 중복을 뺀다 — 그 지점으로 읽는다 · 캐시 금지", async () => {
    const res = await GET(req(`ids=${encodeURIComponent([A, "drop", B, A].join(","))}`));
    expect(mocks.load).toHaveBeenCalledWith("tn", [A, B]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).cards[A].title).toBe("아직 안 나간 이유");
  });

  it("던지면 500 + 구조화 로그(화면은 '미발송' 글자만 그대로)", async () => {
    mocks.load.mockRejectedValueOnce(new Error("boom"));
    const res = await GET(req(`ids=${A}`));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ cards: {} });
    expect(mocks.report).toHaveBeenCalledTimes(1);
  });
});
