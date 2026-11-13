import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 🔴 평점(0450a)은 서버 공통 문(코드 표시 스위치 ∧ 지점 report_rating ∧ 쓰기 권한)을 통과할 때만 내려간다 — 화면이 열을 감추는 것만으로는 게이트가 아니다(#77).
 * 서버 응답(listReports)을 직접 보고 잠근다.
 */
const m = vi.hoisted(() => ({ user: vi.fn(), canWrite: vi.fn(), canView: vi.fn(), load: vi.fn(), points: vi.fn(), rows: [] as unknown[] }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canAccessTenant: async () => true, canWriteTenant: m.canWrite }));
vi.mock("@/features/onescreen/server/ment-source-db", () => ({ mentSourceColumnReady: async () => false }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { throw new Error("listReports는 admin을 직접 쓰지 않는다"); } }));
vi.mock("./report-ratings", () => ({ loadReportRatings: m.load, loadRatingPoints: m.points }));
vi.mock("./rating-access", () => ({ canViewReportRatings: m.canView }));

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
        ? query({ data: m.rows, count: m.rows.length, error: null })
        : query({ data: [{ id: "s1", name: "학생" }], error: null }),
  }),
}));

import { listReports } from "./actions";

const rating = { points: 3.3, items: [], parentFeeling: null, suggestion: null, claim: null, claimReason: null, ratedOn: "2026-10-22" };

beforeEach(() => {
  vi.clearAllMocks();
  m.rows = [reportRow];
  m.user.mockResolvedValue({ id: "u1", tenantId: "tenant-a", systemRole: "teacher" });
  m.canView.mockResolvedValue(true);
});

describe("listReports — 평점은 서버 공통 문을 통과할 때만", () => {
  it("🔴 공통 문이 닫히면 평점 표를 읽지도 않고, 행에 평점 키 자체가 없다", async () => {
    m.canView.mockResolvedValue(false);
    const res = await listReports({});
    expect(res.ok).toBe(true);
    expect(res.showRating).toBe(false);
    expect(m.load).not.toHaveBeenCalled();
    expect(res.rows).toHaveLength(1);
    expect("rating" in res.rows![0]!).toBe(false);
  });

  it("공통 문이 열리면 그 페이지 보고서 id로 로그인 지점의 평점을 붙인다", async () => {
    m.load.mockResolvedValue(new Map([["rep1", rating]]));
    const res = await listReports({});
    expect(m.canView).toHaveBeenCalledWith("tenant-a", "teacher");
    expect(res.showRating).toBe(true);
    expect(m.load).toHaveBeenCalledWith("tenant-a", ["rep1"]);
    expect(res.rows![0]!.rating).toEqual(rating);
  });

  it("평점이 없는 보고서는 null('—') — 목록은 그대로", async () => {
    m.load.mockResolvedValue(new Map());
    const res = await listReports({});
    expect(res.ok).toBe(true);
    expect(res.showRating).toBe(true);
    expect(res.rows![0]!.rating).toBeNull();
    expect(res.rows![0]!.studentName).toBe("학생");
  });

});

describe("listReports — 평점 정렬(2026-10-26 원장)", () => {
  const rep = (id: string, report_date: string) => ({ ...reportRow, id, report_date });

  it("쓰기 권한자 = 지점 평점으로 서버가 전체를 줄 세운다 · 평점 없는 보고서는 방향과 무관하게 뒤", async () => {
    m.load.mockResolvedValue(new Map());
    m.rows = [rep("rep1", "2026-10-20"), rep("rep2", "2026-10-21"), rep("rep3", "2026-10-22")];
    m.points.mockResolvedValue(new Map([["rep1", 4], ["rep2", 1]]));
    const asc = await listReports({ sort: "rating", dir: "asc" });
    expect(m.points).toHaveBeenCalledWith("tenant-a");
    expect(asc.rows!.map((r) => r.id)).toEqual(["rep2", "rep1", "rep3"]);
    expect(asc.total).toBe(3);
    const desc = await listReports({ sort: "rating", dir: "desc" });
    expect(desc.rows!.map((r) => r.id)).toEqual(["rep1", "rep2", "rep3"]);
  });

  it("페이지를 넘기면 그 다음 30건 — 끝을 지나면 빈 목록과 전체 건수", async () => {
    m.load.mockResolvedValue(new Map());
    m.rows = [rep("rep1", "2026-10-20")];
    m.points.mockResolvedValue(new Map());
    const res = await listReports({ sort: "rating", page: 3 });
    expect(res).toMatchObject({ ok: true, rows: [], total: 1, page: 3 });
  });

  it("🔴 서버 공통 문이 닫히면 평점 정렬 주소도 평점 표를 읽지 않고 기본 정렬로", async () => {
    m.canView.mockResolvedValue(false);
    m.rows = [rep("rep1", "2026-10-20"), rep("rep2", "2026-10-21")];
    const res = await listReports({ sort: "rating", dir: "asc" });
    expect(res.ok).toBe(true);
    expect(res.showRating).toBe(false);
    expect(m.points).not.toHaveBeenCalled();
    expect(res.rows!.map((r) => r.id)).toEqual(["rep1", "rep2"]);
  });
});
