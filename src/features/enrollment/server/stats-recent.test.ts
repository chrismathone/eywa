import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRecentEnrollmentStats } from "./stats-queries";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => vi.clearAllMocks());
describe("dashboard consultation month window", () => {
  it("1월에는 전년도 12월부터 조회하고 각 달의 수로만 집계한다", async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: [
      { month: "2025-12", total: "10", enrolled: "4", declined: "2", no_show: "1", open_cnt: "3", paid_sum: "0" },
      { month: "2026-01", total: "2", enrolled: "1", declined: "0", no_show: "0", open_cnt: "1", paid_sum: "0" },
    ] });
    const result = await getRecentEnrollmentStats("2026-01-03");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("consultation_monthly_stats", {
      p_start: "2025-11-30T15:00:00.000Z", p_end: "2026-01-31T15:00:00.000Z",
    });
    expect(result.months.map((row) => [row.month, row.rate])).toEqual([["2025-12", 40], ["2026-01", 50]]);
    expect(result.total).toBe(12);
  });
  it("성공한 빈 달의 전환율은 0%가 아니라 null이다", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const result = await getRecentEnrollmentStats("2026-09-12");
    expect(result.months.map((row) => [row.month, row.total, row.rate])).toEqual([["2026-08", 0, null], ["2026-09", 0, null]]);
  });
  it("조회 실패를 빈 두 달로 위장하지 않는다", async () => {
    const error = new Error("unavailable");
    mocks.rpc.mockResolvedValue({ data: null, error });
    await expect(getRecentEnrollmentStats("2026-09-12")).rejects.toThrow(error);
  });
});
