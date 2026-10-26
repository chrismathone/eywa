import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 평점(0450a)은 **수업보고서 쓰기 권한자에게만** 내려간다 — 화면이 열을 감추는 것만으로는 게이트가 아니다(#77).
 * 서버 응답(listReports)을 직접 보고 잠근다.
 */
const m = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), load: vi.fn(), visible: true }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => true, canWriteTenant: m.canWrite }));
vi.mock("@/features/onescreen/server/ment-source-db", () => ({ mentSourceColumnReady: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("listReports는 admin을 직접 쓰지 않는다"); } }));
vi.mock("./report-ratings", () => ({ loadReportRatings: m.load }));
// 표시 스위치(REPORT_RATING_VISIBLE)는 테스트마다 바꾼다 — 아래 세 경우는 켠 상태의 계약, 마지막은 꺼진 상태.
vi.mock("../report-rating", async (orig) => ({
  ...(await orig<typeof import("../report-rating")>()),
  get REPORT_RATING_VISIBLE() {
    return m.visible;
  },
}));

/** PostgREST 빌더 흉내 — 어떤 사슬이든 자기 자신을 돌려주고, await하면 정해 둔 결과가 나온다. */
function query(result: unknown) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "order", "range", "in", "eq", "gte", "lte", "is", "or", "ilike", "not", "limit"]) chain[k] = () => chain;
  chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail);
  return chain;
}

const reportRow = {
  id: "rep1", student_id: "s1", subject: "math", report_date: "2026-10-01", created_at: null,
  classnote_sent_at: null, classnote_status: null, classnote_read_at: null, teacher_name: "김선생",
  share_token: null, source: null, class_id: null, classes: null,
};
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) =>
      t === "lesson_reports"
        ? query({ data: [reportRow], count: 1, error: null })
        : query({ data: [{ id: "s1", name: "학생" }], error: null }),
  }),
}));

import { listReports } from "./actions";

const rating = { points: 3.3, items: [], parentFeeling: null, suggestion: null, claim: null, claimReason: null, ratedOn: "2026-10-22" };

beforeEach(() => {
  vi.clearAllMocks();
  m.visible = true;
  m.user.mockResolvedValue({ id: "u1", tenantId: "tenant-a", systemRole: "teacher" });
});

describe("listReports — 평점은 쓰기 권한자에게만", () => {
  it("🔴 쓰기 권한이 없으면 평점 표를 읽지도 않고, 행에 평점 키 자체가 없다", async () => {
    m.canWrite.mockResolvedValue(false);
    const res = await listReports({});
    expect(res.ok).toBe(true);
    expect(m.load).not.toHaveBeenCalled();
    expect(res.rows).toHaveLength(1);
    expect("rating" in res.rows![0]!).toBe(false);
  });

  it("쓰기 권한이 있으면 그 페이지 보고서 id로 로그인 지점의 평점을 붙인다", async () => {
    m.canWrite.mockResolvedValue(true);
    m.load.mockResolvedValue(new Map([["rep1", rating]]));
    const res = await listReports({});
    expect(m.canWrite).toHaveBeenCalledWith("teacher", "lesson_reports");
    expect(m.load).toHaveBeenCalledWith("tenant-a", ["rep1"]);
    expect(res.rows![0]!.rating).toEqual(rating);
  });

  it("평점이 없는 보고서는 null('—') — 목록은 그대로", async () => {
    m.canWrite.mockResolvedValue(true);
    m.load.mockResolvedValue(new Map());
    const res = await listReports({});
    expect(res.ok).toBe(true);
    expect(res.rows![0]!.rating).toBeNull();
    expect(res.rows![0]!.studentName).toBe("학생");
  });

  it("🔴 표시 스위치가 꺼지면(2026-10-26 원장 '전혀 신뢰안가는 점수') 쓰기 권한자에게도 표를 읽지 않고 평점 키가 없다", async () => {
    m.visible = false;
    m.canWrite.mockResolvedValue(true);
    const res = await listReports({});
    expect(res.ok).toBe(true);
    expect(m.load).not.toHaveBeenCalled();
    expect("rating" in res.rows![0]!).toBe(false);
  });
});
