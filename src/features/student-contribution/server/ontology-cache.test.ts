import { beforeEach, expect, it, vi } from "vitest";
import type { StudentFact } from "@/features/students/ontology/types";
const state = vi.hoisted(() => ({ cache: new Map<string, unknown>(), reads: 0, tenant: "t", eventError: "PGRST202" }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[]) => async (...args: unknown[]) => {
  const key = JSON.stringify([keys, args]);
  if (!state.cache.has(key)) state.cache.set(key, await fn(...args));
  return state.cache.get(key);
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: null, error: { code: state.eventError } }), from: () => {
  const q = { select: () => q, eq: () => q, order: () => q, range: () => ({ returns: async () => {
    state.reads++;
    const f: StudentFact = { tenantId: state.tenant, id: "a", studentId: "s", kind: "attendance", value: {}, access: "student", state: "active", basis: "recorded",
      occurred: { precision: "day", value: "2026-10-01" }, recordedAt: "2026-10-02", evidence: [{ source: "attendance_records", id: "a", studentId: "s" }], related: [{ kind: "class", id: "c" }] };
    return { data: [{ student_id: "s", computed_at: "2026-10-02", facts: [f, { ...f, id: "b", access: "billing" }] }], error: null };
  } }) }; return q;
} }) }));
import { cachedOntologyViews } from "./ontology-cache";
beforeEach(() => { state.cache.clear(); state.reads = 0; state.tenant = "t"; state.eventError = "PGRST202"; });
const load = async (readable: string[] | null) => (await cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], readable, "v1")).views;
it("같은 범위는 재사용하되 전체·열람 불가·담당 학생 범위를 섞지 않는다", async () => {
  expect((await load(null))["academy:t"]!.factCount).toBe(2);
  expect((await load([]))["academy:t"]!.factCount).toBe(1);
  expect((await load(["s"]))["academy:t"]!.factCount).toBe(2);
  await load(null); await load([]); await load(["s"]);
  expect(state.reads).toBe(1);
  expect(state.cache.size).toBe(2);
});
it("does not cache a source outage and recovers without reloading other records", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  state.eventError = "57014";
  const failed = await cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], null, "v1");
  expect(failed.parentEventNotice).toContain("불러오지 못했습니다");
  expect(failed.views["academy:t"]!.factCount).toBe(2);
  state.eventError = "PGRST202";
  expect((await cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], null, "v1")).parentEventNotice).toBeNull();
  expect(state.reads).toBe(1);
  warning.mockRestore();
});
it("학원·월·집계 버전·병합·대상 변경이 이전 캐시를 사용하지 않는다", async () => {
  await load(null);
  await cachedOntologyViews("t", "2026-09", ["s"], [["s", "s"]], null, "v1");
  await cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], null, "v2");
  expect((await cachedOntologyViews("t", "2026-10", [], [["s", "s"]], null, "v1")).views).toEqual({});
  const merged = await cachedOntologyViews("t", "2026-10", ["merged"], [["s", "merged"]], null, "v1");
  expect(merged.views["academy:t"]!.students).toEqual(["merged"]);
  state.tenant = "other";
  expect((await cachedOntologyViews("other", "2026-10", ["s"], [["s", "s"]], null, "v1")).views["academy:other"]!.factCount).toBe(2);
  expect(state.reads).toBe(4);
});
it("사라진 학생 연결은 격리하고 불완전성을 반환한다", async () => {
  expect(await cachedOntologyViews("t", "2026-10", ["s"], [], null, "v1")).toEqual({ views: {}, unresolved: 1, parentEventNotice: null });
});
