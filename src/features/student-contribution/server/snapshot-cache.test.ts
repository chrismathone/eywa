import { beforeEach, expect, it, vi } from "vitest";
import { emptyRaws, DEFAULT_CONFIG } from "../model/config";
import { scoreRaws } from "../model/calc";
const state = vi.hoisted(() => ({ cached: [] as unknown[], keys: [] as string[], reads: vi.fn() }));
// Simulate a Next data-cache hit from a previous deployment: the database loader is never called.
vi.mock("next/cache", () => ({ unstable_cache: (_loader: unknown, keys: string[]) => { state.keys = keys; return async () => state.cached; } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: state.reads }));
import { cachedContributionTotals } from "./snapshot-cache";
beforeEach(() => { state.cached = []; state.keys = []; state.reads.mockClear(); });
const oldRaws = () => { const raws = { ...emptyRaws(), tuitionWon: 100_000 }; Reflect.deleteProperty(raws, "parentSeminarEvents"); return raws; };
it("normalizes old totals after a persistent cache hit, without mutating the cached payload", async () => {
  const raw = oldRaws(), recent = oldRaws();
  state.cached = [{ studentId: "s", raws: raw, recent, computedAt: "2026-10-26", unavailable: [] }];
  const [result] = await cachedContributionTotals("tenant", ["s"], "2025-11", "v1");
  expect(result!.raws.parentSeminarEvents).toBe(0); expect(result!.recent.parentSeminarEvents).toBe(0);
  expect(scoreRaws(result!.raws, DEFAULT_CONFIG).total).toBe(1);
  expect(raw).not.toHaveProperty("parentSeminarEvents"); expect(recent).not.toHaveProperty("parentSeminarEvents");
  expect(state.reads).not.toHaveBeenCalled(); expect(state.keys).toContain("tenant");
});
it("preserves current values and still rejects malformed existing metrics", async () => {
  state.cached = [{ studentId: "s", raws: { ...emptyRaws(), parentSeminarEvents: 2 }, recent: emptyRaws() }];
  expect((await cachedContributionTotals("tenant", ["s"], "2025-11", "v1"))[0]!.raws.parentSeminarEvents).toBe(2);
  state.cached = [{ studentId: "s", raws: { ...oldRaws(), tuitionWon: null }, recent: oldRaws() }];
  await expect(cachedContributionTotals("tenant", ["s"], "2025-11", "v1")).rejects.toThrow("tuitionWon");
});
