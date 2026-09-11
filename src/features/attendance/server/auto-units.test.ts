import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
import { resolveAutoUnits } from "./auto-units";

type Op = [string, unknown[]];
type Call = { table: string; ops: Op[] };
type TableResult = { data?: unknown[]; error?: { message: string } };

/** PostgREST 빌더 흉내 — 체인 메서드는 기록만 하고, await 하면 표별로 준비한 결과를 준다(첫 페이지만 행). */
function fakeClient(results: Record<string, TableResult>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const b: Record<string, unknown> = {};
      for (const m of ["select", "in", "eq", "lte", "or", "order", "range"]) {
        b[m] = (...args: unknown[]) => {
          call.ops.push([m, args]);
          return b;
        };
      }
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const r = results[table] ?? { data: [] };
        const range = call.ops.find(([m]) => m === "range");
        const first = !range || range[1][0] === 0;
        return Promise.resolve({ data: r.error ? null : first ? (r.data ?? []) : [], error: r.error ?? null }).then(
          resolve,
          reject,
        );
      };
      return b;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const MATH = "11111111-1111-1111-1111-111111111111";
const ENG = "22222222-2222-2222-2222-222222222222";
const THU = "2026-09-10";
const sched = (classId: string, start: string, end: string, extra: Record<string, unknown> = {}) => ({
  class_id: classId,
  day_of_week: "thu",
  start_time: `${start}:00`,
  end_time: `${end}:00`,
  valid_from: "2026-03-01",
  valid_to: null,
  slot_teacher_label: null,
  ...extra,
});
const threeBy55 = (classId: string) => [
  sched(classId, "16:00", "16:55"),
  sched(classId, "17:00", "17:55"),
  sched(classId, "18:00", "18:55"),
];

afterEach(() => vi.restoreAllMocks());

describe("resolveAutoUnits — 서버 조회(과목·배치) → (반|날짜) → 자동 시수", () => {
  it("수학 165분 = 1.5 · 영어 반은 같은 배치여도 없다", async () => {
    const { client } = fakeClient({
      classes: { data: [{ id: MATH, subject: "math" }, { id: ENG, subject: "english" }] },
      class_schedules: { data: [...threeBy55(MATH), ...threeBy55(ENG)] },
    });
    const got = await resolveAutoUnits(client, [
      { classId: MATH, date: THU },
      { classId: ENG, date: THU },
    ]);
    expect(got.get(`${MATH}|${THU}`)).toBe(1.5);
    expect(got.has(`${ENG}|${THU}`)).toBe(false);
  });

  it("🔴 admin 클라이언트용 tenantId를 주면 **두 조회 모두** tenant_id로 좁힌다(RLS 우회 경로)", async () => {
    const { client, calls } = fakeClient({ classes: { data: [] }, class_schedules: { data: [] } });
    await resolveAutoUnits(client, [{ classId: MATH, date: THU }], { tenantId: "t-1" });
    expect(calls.map((c) => c.table).sort()).toEqual(["class_schedules", "classes"]);
    for (const c of calls) {
      expect(c.ops, c.table).toContainEqual(["eq", ["tenant_id", "t-1"]]);
    }
  });

  it("tenantId가 없으면(세션 클라이언트 — RLS가 격리) 테넌트 필터를 덧붙이지 않는다", async () => {
    const { client, calls } = fakeClient({ classes: { data: [] }, class_schedules: { data: [] } });
    await resolveAutoUnits(client, [{ classId: MATH, date: THU }]);
    for (const c of calls) expect(c.ops.some(([m, a]) => m === "eq" && a[0] === "tenant_id"), c.table).toBe(false);
  });

  it("배치 조회는 날짜 범위로 좁히고(이력 표) id 순 페이지네이션한다", async () => {
    const { client, calls } = fakeClient({ classes: { data: [] }, class_schedules: { data: [] } });
    await resolveAutoUnits(client, [
      { classId: MATH, date: "2026-09-03" },
      { classId: MATH, date: THU },
    ]);
    const s = calls.find((c) => c.table === "class_schedules")!;
    expect(s.ops).toContainEqual(["lte", ["valid_from", THU]]);
    expect(s.ops).toContainEqual(["or", ["valid_to.is.null,valid_to.gte.2026-09-03"]]);
    expect(s.ops).toContainEqual(["order", ["id", { ascending: true }]]);
    expect(s.ops.some(([m]) => m === "range")).toBe(true);
  });

  it("🔴 조회가 실패하면 자동값을 넣지 않는다(빈 맵 = 종전처럼 null) + 오류를 남긴다", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const broken of ["classes", "class_schedules"]) {
      const { client } = fakeClient({
        classes: { data: [{ id: MATH, subject: "math" }] },
        class_schedules: { data: threeBy55(MATH) },
        [broken]: { error: { message: "boom" } },
      });
      const got = await resolveAutoUnits(client, [{ classId: MATH, date: THU }]);
      expect(got.size, broken).toBe(0);
    }
    expect(err).toHaveBeenCalled();
  });

  it("칸이 없거나 날짜 형식이 아니면 조회 자체를 안 한다", async () => {
    const { client, calls } = fakeClient({});
    expect((await resolveAutoUnits(client, [])).size).toBe(0);
    expect((await resolveAutoUnits(client, [{ classId: MATH, date: "2026-9-10" }])).size).toBe(0);
    expect(calls).toHaveLength(0);
  });
});
