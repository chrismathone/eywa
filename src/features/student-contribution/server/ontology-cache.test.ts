import { beforeEach, expect, it, vi } from "vitest";
import type { StudentFact } from "@/features/students/ontology/types";
const state = vi.hoisted(() => ({ cache: new Map<string, unknown>(), reads: 0, tenant: "t" }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[]) => async (...args: unknown[]) => {
  const key = JSON.stringify([keys, args]);
  if (!state.cache.has(key)) state.cache.set(key, await fn(...args));
  return state.cache.get(key);
} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, order: () => q, range: () => ({ returns: async () => {
    state.reads++;
    const f: StudentFact = { tenantId: state.tenant, id: "a", studentId: "s", kind: "attendance", value: {}, access: "student", state: "active", basis: "recorded",
      occurred: { precision: "day", value: "2026-10-01" }, recordedAt: "2026-10-02", evidence: [{ source: "attendance_records", id: "a", studentId: "s" }], related: [{ kind: "class", id: "c" }] };
    return { data: [{ student_id: "s", computed_at: "2026-10-02", facts: [f, { ...f, id: "b", access: "billing" }] }], error: null };
  } }) }; return q;
} }) }));
import { cachedOntologyViews } from "./ontology-cache";
beforeEach(() => { state.cache.clear(); state.reads = 0; state.tenant = "t"; });
const load = (readable: string[] | null) => cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], readable, "v1");
it("같은 범위는 재사용하되 전체·열람 불가·담당 학생 범위를 섞지 않는다", async () => {
  expect((await load(null))["academy:t"]!.factCount).toBe(2);
  expect((await load([]))["academy:t"]!.factCount).toBe(1);
  expect((await load(["s"]))["academy:t"]!.factCount).toBe(2);
  await load(null); await load([]); await load(["s"]);
  expect(state.reads).toBe(3);
});
it("학원·월·집계 버전·병합·대상 변경이 이전 캐시를 사용하지 않는다", async () => {
  await load(null);
  await cachedOntologyViews("t", "2026-09", ["s"], [["s", "s"]], null, "v1");
  await cachedOntologyViews("t", "2026-10", ["s"], [["s", "s"]], null, "v2");
  expect(await cachedOntologyViews("t", "2026-10", [], [["s", "s"]], null, "v1")).toEqual({});
  const merged = await cachedOntologyViews("t", "2026-10", ["merged"], [["s", "merged"]], null, "v1");
  expect(merged["academy:t"]!.students).toEqual(["merged"]);
  state.tenant = "other";
  expect((await cachedOntologyViews("other", "2026-10", ["s"], [["s", "s"]], null, "v1"))["academy:other"]!.factCount).toBe(2);
  expect(state.reads).toBe(6);
});
it("알 수 없는 병합 연결은 실패하고 실패 결과를 캐시하지 않는다", async () => {
  await expect(cachedOntologyViews("t", "2026-10", ["s"], [], null, "v1")).rejects.toThrow();
  await expect(cachedOntologyViews("t", "2026-10", ["s"], [], null, "v1")).rejects.toThrow();
  expect(state.reads).toBe(2);
});
