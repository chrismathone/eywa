import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), read: vi.fn(), tag: vi.fn() }));
vi.mock("./access", () => ({ visitorAccess: m.access }));
vi.mock("./google", () => ({ cachedVisitorMonth: m.read, visitorMonthTag: (tenant: string, month: string) => `${tenant}:${month}` }));
vi.mock("next/cache", () => ({ updateTag: m.tag }));
vi.mock("@/lib/date-kst", async importOriginal => ({ ...await importOriginal<object>(), kstToday: () => "2026-10-20" }));
import { loadVisitorMonth } from "./actions";
beforeEach(() => {
  vi.clearAllMocks(); m.access.mockResolvedValue({ tenantId: "academy" }); m.read.mockResolvedValue({ complete: true });
});
it.each([null, "2026-13", "2027-01", "1999-12", "2026-1", { tenantId: "other" }])("rejects invalid month %s", async input => {
  expect(await loadVisitorMonth(input)).toHaveProperty("error"); expect(m.read).not.toHaveBeenCalled();
});
it("checks permissions on every call before cache or refresh", async () => {
  await loadVisitorMonth("2026-01"); m.access.mockResolvedValue(null);
  expect(await loadVisitorMonth("2026-01", true)).toHaveProperty("error");
  expect(m.read).toHaveBeenCalledTimes(1); expect(m.tag).not.toHaveBeenCalled();
});
it("binds requests and cache invalidation to session tenant", async () => {
  await loadVisitorMonth("2026-01", true);
  expect(m.read).toHaveBeenCalledWith("academy", "2026-01");
  expect(m.tag).toHaveBeenCalledWith("academy:2026-01");
});
it("does not expose server error details", async () => {
  m.read.mockRejectedValue(new Error("secret url"));
  const r = await loadVisitorMonth("2026-01"); expect(r).toHaveProperty("error"); expect(JSON.stringify(r)).not.toContain("secret");
});
