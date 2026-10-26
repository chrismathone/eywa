import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ directory: vi.fn(), snapshot: vi.fn(), totals: vi.fn() }));
vi.mock("./directory", () => ({ getContributionSnapshot: m.snapshot }));
vi.mock("./score-roster", () => ({ getContributionScoreRoster: m.directory }));
vi.mock("./snapshot-cache", () => ({ cachedContributionTotals: m.totals }));
vi.mock("@/lib/date-kst", async (original) => ({ ...await original<object>(), kstMonth: () => "2026-10" }));
import { readContributionRecent } from "./recent-action";
const input = { period: 3, month: "2026-10", refreshedAt: "2026-10-25T15:41:00Z", revision: 2 };
beforeEach(() => {
  vi.resetAllMocks(); m.directory.mockResolvedValue({ gate: { tenantId: "tenant" }, rows: [{ id: "allowed" }] });
  m.snapshot.mockResolvedValue({ ready: true, refreshedAt: input.refreshedAt, revision: 2 }); m.totals.mockResolvedValue([]);
});
it("현재 권한·지점·학생 범위로 선택 기간 집계만 읽는다", async () => {
  expect(await readContributionRecent(input)).toEqual({ rows: [] });
  expect(m.totals).toHaveBeenCalledWith("tenant", ["allowed"], "2026-08", input.refreshedAt);
});
it("권한 없음·집계 기준 변경·잘못된 기간이면 점수를 읽지 않는다", async () => {
  expect(await readContributionRecent({ ...input, period: 2 })).toHaveProperty("error");
  expect(await readContributionRecent({ ...input, revision: 1 })).toHaveProperty("error");
  expect(await readContributionRecent({ ...input, month: "2026-09" })).toHaveProperty("error");
  m.directory.mockResolvedValue(null); expect(await readContributionRecent(input)).toHaveProperty("error");
  expect(m.totals).not.toHaveBeenCalled();
});
