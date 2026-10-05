import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 고아 데이터 점검(`findOrphans`)의 **행 수 한도**(2026-10-06) — PostgREST를 흉내 낸 모의 DB로 돌린다.
 *  · 한 번에 1,000행까지만 돌려준다(그 이상은 오류 없이 잘린다 — [[#54]]).
 *  · `.in()`에 id가 너무 많으면 주소가 길어 요청이 실패한다(414 — [[#53]]).
 * 종전의 '스케줄 없는 활성 반' 조회는 무페이징 + 단일 `.in()` + 오류 삼킴이라, 반이 많거나 스케줄 이력이 쌓이면
 * 멀쩡한 반이 '스케줄 없음'으로 나왔다(오류가 나면 **모든 반**이). 합성 값만 쓴다.
 */
type Row = Record<string, unknown>;
type Call = { table: string; filters: unknown[][] };

const MAX_ROWS = 1000;
const MAX_IN_IDS = 150;

const m = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  calls: [] as unknown[],
  failTable: null as string | null,
}));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: Call = { table, filters: [] };
      const chain: Record<string, unknown> = {
        select: () => chain,
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
          m.calls.push(call);
          return Promise.resolve(run(call)).then(resolve, reject);
        },
      };
      for (const name of ["eq", "neq", "in", "is", "or", "order", "range"]) {
        chain[name] = (...args: unknown[]) => {
          call.filters.push([name, ...args]);
          return chain;
        };
      }
      return chain;
    },
  }),
}));

function run(call: Call): { data: Row[] | null; error: { message: string } | null } {
  if (m.failTable === call.table) return { data: null, error: { message: "upstream timeout" } };
  let rows = [...(m.tables[call.table] ?? [])];
  let range: [number, number] | null = null;
  for (const [name, ...args] of call.filters) {
    if (name === "eq") rows = rows.filter((r) => r[args[0] as string] === args[1]);
    if (name === "in") {
      const ids = args[1] as string[];
      if (ids.length > MAX_IN_IDS) return { data: null, error: { message: "414 Request-URI Too Large" } };
      rows = rows.filter((r) => ids.includes(r[args[0] as string] as string));
    }
    if (name === "order") rows.sort((a, b) => String(a[args[0] as string]).localeCompare(String(b[args[0] as string])));
    if (name === "range") range = [args[0] as number, args[1] as number];
  }
  if (range) rows = rows.slice(range[0], range[1] + 1);
  // 한 번에 돌려주는 행 수의 한도 — 넘으면 오류 없이 잘린다.
  return { data: rows.slice(0, MAX_ROWS), error: null };
}

import { findOrphans } from "./queries";

const id = (prefix: string, n: number) => `${prefix}-${String(n).padStart(5, "0")}`;
const calls = () => m.calls as Call[];

beforeEach(() => {
  vi.clearAllMocks();
  m.calls = [];
  m.failTable = null;
  m.tables = { students: [], enrollments: [], classes: [], class_schedules: [] };
});

describe("스케줄 없는 활성 반", () => {
  it("🔴 운영 중인 반이 1,000개를 넘어도 스케줄 없는 반만 고른다 — 멀쩡한 반을 올리지 않는다", async () => {
    const without = new Set([id("c", 7), id("c", 1150)]);
    m.tables.classes = Array.from({ length: 1200 }, (_, i) => ({ id: id("c", i), class_name: `반 ${i}`, is_active: true }));
    m.tables.class_schedules = m.tables.classes
      .filter((c) => !without.has(c.id as string))
      .map((c, i) => ({ id: id("sch", i), class_id: c.id }));

    const report = await findOrphans();
    expect(report.classesWithoutSchedules.map((c) => c.id).sort()).toEqual([...without].sort());
  });

  it("🔴 스케줄 이력이 쌓여 100반 묶음 하나가 1,000행을 넘어도, 꼬리에 걸린 반을 '스케줄 없음'으로 올리지 않는다", async () => {
    m.tables.classes = Array.from({ length: 100 }, (_, i) => ({ id: id("c", i), class_name: `반 ${i}`, is_active: true }));
    // 앞의 99개 반이 이력을 잔뜩 갖고(1,040행), 마지막 반의 스케줄은 id 순으로 맨 끝(1,041번째)에 한 줄뿐이다.
    const history = Array.from({ length: 1040 }, (_, i) => ({ id: id("sch", i), class_id: id("c", i % 99) }));
    m.tables.class_schedules = [...history, { id: id("sch", 99999), class_id: id("c", 99) }];

    const report = await findOrphans();
    expect(report.classesWithoutSchedules).toEqual([]);
  });

  it("폐지된 반은 대상이 아니다 · 스케줄이 한 줄도 없는 반은 이름과 함께 나온다", async () => {
    m.tables.classes = [
      { id: "c-live", class_name: "월수 A", is_active: true },
      { id: "c-empty", class_name: "새 반", is_active: true },
      { id: "c-closed", class_name: "폐지된 반", is_active: false },
    ];
    m.tables.class_schedules = [{ id: "sch-1", class_id: "c-live" }];
    const report = await findOrphans();
    expect(report.classesWithoutSchedules).toEqual([{ id: "c-empty", className: "새 반", isActive: true }]);
  });

  it.each(["classes", "class_schedules"])("🔴 %s 조회가 실패하면 던진다 — 빈 목록('문제 없음')이나 '전 반 스케줄 없음'으로 답하지 않는다", async (table) => {
    m.tables.classes = [{ id: "c-live", class_name: "월수 A", is_active: true }];
    m.tables.class_schedules = [{ id: "sch-1", class_id: "c-live" }];
    m.failTable = table;
    await expect(findOrphans()).rejects.toThrow();
  });

  it("페이지를 넘겨 읽는 조회는 전부 id 순으로 고정한다(순서가 없으면 페이지 경계에서 행이 빠지거나 겹친다)", async () => {
    m.tables.classes = [{ id: "c-live", class_name: "월수 A", is_active: true }];
    m.tables.class_schedules = [{ id: "sch-1", class_id: "c-live" }];
    await findOrphans();
    expect(calls().length).toBeGreaterThanOrEqual(5);
    for (const call of calls()) {
      expect(call.filters.find((f) => f[0] === "range"), `${call.table}: range 없음`).toBeTruthy();
      expect(call.filters.find((f) => f[0] === "order"), `${call.table}: order 없음`).toEqual(["order", "id"]);
    }
  });
});

describe("학생 쪽 판정은 그대로다", () => {
  it("수강이 없고 마지막 수강이 끝난 지 오래된 재원생 · 퇴원했는데 수강이 열려 있는 학생", async () => {
    m.tables.students = [
      { id: "s-idle", name: "오래 쉰 학생", status: "enrolled", enrolled_at: "2020-01-01" },
      { id: "s-active", name: "다니는 학생", status: "enrolled", enrolled_at: "2020-01-01" },
      { id: "s-gone", name: "퇴원생", status: "withdrawn", enrolled_at: "2020-01-01" },
    ];
    m.tables.enrollments = [
      { id: "e-1", student_id: "s-idle", end_date: "2020-06-01" },
      { id: "e-2", student_id: "s-active", end_date: null },
      { id: "e-3", student_id: "s-gone", end_date: null },
    ];
    const report = await findOrphans();
    expect(report.studentsWithoutEnrollments.map((s) => s.id)).toEqual(["s-idle"]);
    expect(report.enrollmentsWithoutEndDate).toBe(1);
  });

  it("학생·수강이 1,000행을 넘어도 전건으로 판정한다", async () => {
    m.tables.students = Array.from({ length: 1500 }, (_, i) => ({ id: id("s", i), name: `학생 ${i}`, status: "enrolled", enrolled_at: "2020-01-01" }));
    // 전원이 수강 중이다 — 1,000행에서 잘리면 뒤 500명이 '수강 없는 재원생'으로 나온다.
    m.tables.enrollments = m.tables.students.map((s, i) => ({ id: id("e", i), student_id: s.id, end_date: null }));
    const report = await findOrphans();
    expect(report.studentsWithoutEnrollments).toEqual([]);
  });
});
