import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ target: vi.fn(), binding: vi.fn(), rpc: vi.fn(), licenses: [] as unknown[], stored: { data: [] as unknown[], error: null as unknown } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/date-kst", async (original) => ({ ...await original<object>(), kstToday: () => "2026-10-17" }));
vi.mock("./sync-server", () => ({ sourceBindingForTenant: mocks.binding, targetRequest: mocks.target }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      if (table === "tenant_licenses") return { select: () => ({ eq: async () => ({ data: mocks.licenses, error: null }) }) };
      const chain = { select: () => chain, eq: () => chain, gte: () => chain, lte: async () => mocks.stored };
      return chain;
    },
  }),
}));
import { changedResultDays, syncTodaysMathResults } from "./results-sync";

const tenantId = "00000000-0000-4000-8000-000000000001";
const bindingId = "00000000-0000-4000-8000-000000000002";
const studentId = "00000000-0000-4000-8000-000000000003";
const testId = "00000000-0000-4000-8000-000000000004";
const A = "a".repeat(64), B = "b".repeat(64), C = "c".repeat(64);
const row = { sourceTestId: testId, sourceStudentId: studentId, sourceClassId: null, kind: "daily", title: null, unitName: "u", testDate: "2026-10-15",
  questionCount: 5, absent: false, score: 80, correctCount: 4, takenAt: "2026-10-15T01:00:00.000Z" };

describe("changed days", () => {
  it("refetches days whose digest differs or that vanished remotely while rows remain, newest first", () => {
    expect(changedResultDays(
      [{ date: "2026-10-10", sha256: A }, { date: "2026-10-12", sha256: B }, { date: "2026-10-15", sha256: C }],
      [{ test_date: "2026-10-10", digest: A, row_count: 3 }, { test_date: "2026-10-12", digest: A, row_count: 1 },
        { test_date: "2026-10-01", digest: A, row_count: 2 }, { test_date: "2026-10-02", digest: A, row_count: 0 }],
    )).toEqual(["2026-10-15", "2026-10-12", "2026-10-01"]);
  });
});

describe("results sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.licenses = [{ tenant_id: tenantId, is_active: true, expires_at: null }];
    mocks.stored = { data: [], error: null };
    mocks.binding.mockReturnValue({ tenantId, bindingId });
    mocks.rpc.mockResolvedValue({ data: 1, error: null });
    mocks.target.mockImplementation(async (_config: unknown, path: string) => path.startsWith("/api/integrations/eywa/v2/results?")
      ? { bindingId, from: "2026-09-02", to: "2026-10-24", days: [{ date: "2026-10-15", count: 1, sha256: A }] }
      : { bindingId, date: "2026-10-15", sha256: A, rows: [row] });
  });

  it("fetches the changed day with the fixed binding and window, and replaces it through the DB function", async () => {
    expect(await syncTodaysMathResults()).toEqual([{ tenantId, status: "synced", days: 1, rows: 1 }]);
    expect(mocks.target.mock.calls.map((c) => c[1])).toEqual([
      `/api/integrations/eywa/v2/results?bindingId=${bindingId}&from=2026-09-02&to=2026-10-24`,
      `/api/integrations/eywa/v2/results/2026-10-15?bindingId=${bindingId}`,
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith("todays_math_apply_result_day", { p_tenant: tenantId, p_date: "2026-10-15", p_digest: A, p_rows: [{ ...row, maxScore: null }] });
  });

  it("passes the max score through when Today Math sends it (0372a)", async () => {
    mocks.target.mockImplementation(async (_c: unknown, path: string) => path.includes("results?")
      ? { bindingId, from: "2026-09-02", to: "2026-10-24", days: [{ date: "2026-10-15", count: 1, sha256: A }] }
      : { bindingId, date: "2026-10-15", sha256: A, rows: [{ ...row, maxScore: 88.33 }] });
    await syncTodaysMathResults();
    expect(mocks.rpc.mock.calls[0][1].p_rows[0].maxScore).toBe(88.33);
  });

  it("does nothing when the digest is unchanged", async () => {
    mocks.stored = { data: [{ test_date: "2026-10-15", digest: A, row_count: 1 }], error: null };
    expect(await syncTodaysMathResults()).toEqual([{ tenantId, status: "synced", days: 0, rows: 0 }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("🔴 an outage or refusal changes nothing (never applies an empty day)", async () => {
    mocks.target.mockRejectedValue(new Error("target_unavailable"));
    expect(await syncTodaysMathResults()).toEqual([{ tenantId, status: "unavailable", days: 0, rows: 0 }]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects a day whose rows belong to another date or binding", async () => {
    mocks.target.mockImplementation(async (_c: unknown, path: string) => path.includes("results?")
      ? { bindingId, from: "2026-09-02", to: "2026-10-24", days: [{ date: "2026-10-15", count: 1, sha256: A }] }
      : { bindingId, date: "2026-10-15", sha256: A, rows: [{ ...row, testDate: "2026-10-14" }] });
    expect((await syncTodaysMathResults())[0].status).toBe("unavailable");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("one bad day does not block the other days", async () => {
    mocks.target.mockImplementation(async (_c: unknown, path: string) => {
      if (path.includes("results?")) return { bindingId, from: "2026-09-02", to: "2026-10-24", days: [{ date: "2026-10-15", count: 1, sha256: A }, { date: "2026-10-14", count: 1, sha256: B }] };
      if (path.includes("2026-10-15")) throw new Error("target_unavailable");
      return { bindingId, date: "2026-10-14", sha256: B, rows: [{ ...row, testDate: "2026-10-14" }] };
    });
    expect(await syncTodaysMathResults()).toEqual([{ tenantId, status: "synced", days: 1, rows: 1 }]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("skips quietly before the SQL is applied, and skips tenants without the license or a binding", async () => {
    mocks.stored = { data: [], error: { code: "PGRST205" } };
    expect(await syncTodaysMathResults()).toEqual([{ tenantId, status: "not_ready", days: 0, rows: 0 }]);
    mocks.licenses = [{ tenant_id: tenantId, is_active: false, expires_at: null }];
    expect(await syncTodaysMathResults()).toEqual([]);
    mocks.licenses = [{ tenant_id: tenantId, is_active: true, expires_at: null }];
    mocks.binding.mockReturnValue(undefined);
    expect(await syncTodaysMathResults()).toEqual([]);
  });
});
