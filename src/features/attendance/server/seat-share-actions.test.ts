import { beforeEach, describe, expect, it, vi } from "vitest";

// 회차 확정 '자리 몫' 줄의 서버 문(원장 2026-10-07 "어떤반의 수업/JJ 비율을 19/5를 20/4로") — 값의 규칙은 seat-share-adjust.test.ts가 본다.
type Write = { op: "upsert" | "delete"; table: string; values?: Record<string, unknown>[]; match?: Record<string, unknown>; in?: [string, string[]]; options?: unknown };
const h = vi.hoisted(() => ({
  gate: vi.fn(), facts: vi.fn(), log: vi.fn(), read: vi.fn(), plan: vi.fn(),
  roster: [] as { student_id: string }[],
  writes: [] as Write[],
  /** 쓰기 오류 — 함수면 그 쓰기를 보고 정한다(뒤 문장만 실패시키는 시험). */
  writeError: null as unknown,
  students: [] as { id: string; name: string }[], users: [] as { id: string; display_name: string | null }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: { holidays: [] } }) }));
vi.mock("../calendar", () => ({ buildHolidayMap: () => ({}) }));
vi.mock("./salary-rates", () => ({ attendanceSalaryAdminOrNull: h.gate }));
vi.mock("./scope-ownership", () => ({ loadScopeFacts: h.facts }));
vi.mock("./teacher-term-share", () => ({ loadClassTermPlan: h.plan }));
vi.mock("./seat-share-adjust", () => ({
  SEAT_SHARE_TABLE: "attendance_seat_share_adjust",
  readClassSeatShare: h.read,
  seatShareTableMissing: (error: { code?: string } | null) => error?.code === "42P01" || error?.code === "PGRST205",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let ids: string[] = [];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = (_column: string, values: string[]) => { ids = values; return b; };
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({
        data: (table === "students" ? h.students : h.users).filter((row) => ids.includes(row.id)), error: null,
      }).then(resolve);
      return b;
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      let range: [number, number] | null = null;
      let write: Write | null = null;
      const b: Record<string, unknown> = {};
      for (const name of ["select", "eq", "lte", "or", "order"]) b[name] = () => b;
      b.range = (f: number, t: number) => { range = [f, t]; return b; };
      b.upsert = (values: Record<string, unknown>[], options: unknown) => { write = { op: "upsert", table, values, options }; return b; };
      b.delete = () => { write = { op: "delete", table }; return b; };
      b.match = (match: Record<string, unknown>) => { if (write) write.match = match; return b; };
      b.in = (column: string, values: string[]) => { if (write) write.in = [column, values]; return b; };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (write) {
          h.writes.push(write);
          const error = typeof h.writeError === "function" ? (h.writeError as (w: Write) => unknown)(write) : h.writeError;
          return Promise.resolve({ error }).then(resolve);
        }
        return Promise.resolve({ data: range ? h.roster.slice(range[0], range[1] + 1) : h.roster, error: null }).then(resolve);
      };
      return b;
    },
  }),
}));

import { loadSeatShareSheet, saveSeatShareAdjust } from "./seat-share-actions";

const CLASS = "aaaaaaaa-1111-4111-8111-111111111111";
const S1 = "bbbbbbbb-2222-4222-8222-222222222221";
const S2 = "bbbbbbbb-2222-4222-8222-222222222222";
const OUTSIDER = "bbbbbbbb-2222-4222-8222-222222222229";
const TEACHER = "cccccccc-3333-4333-8333-333333333333";
const OTHER = "dddddddd-4444-4444-8444-444444444444";
const STRANGER = "eeeeeeee-5555-4555-8555-555555555555";
const PERIOD = "2026-09";
const slot = (startTime: string, over: Record<string, unknown> = {}) => ({ dayOfWeek: "wed", startTime, teacherId: null, slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null, ...over });
const plan = (seat = 5) => Object.assign(new Map([[TEACHER, 19], [OTHER, 4], ["", seat]]), { homeroomTeacherId: TEACHER });
const entry = (over: Record<string, unknown> = {}) => ({ teacherId: TEACHER, units: 1, students: {}, ...over });
/** 선생님 한 명 값만 보내는 저장. */
const save = (over: Record<string, unknown> = {}) => saveSeatShareAdjust({ classId: CLASS, period: PERIOD, teachers: [entry(over)] } as never);
const saveAll = (teachers: Record<string, unknown>[], over: Record<string, unknown> = {}) => saveSeatShareAdjust({ classId: CLASS, period: PERIOD, teachers, ...over } as never);
const KEY = { tenant_id: "tenant", class_id: CLASS, period: PERIOD };

beforeEach(() => {
  vi.clearAllMocks(); h.writes = []; h.writeError = null;
  h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" });
  // 담임(TEACHER) 19:20 · 교시 담당(OTHER) 18:20 · JJ실 20:20
  h.facts.mockResolvedValue(new Map([[CLASS, { homeroomTeacherId: TEACHER, slots: [slot("19:20", { teacherId: TEACHER }), slot("18:20", { teacherId: OTHER }), slot("20:20", { slotTeacherLabel: "JJ" })] }]]));
  h.roster = [{ student_id: S1 }, { student_id: S2 }, { student_id: S1 }];
  h.read.mockResolvedValue(new Map());
  h.plan.mockResolvedValue(plan());
  h.students = [{ id: S1, name: "나학생" }, { id: S2, name: "가학생" }, { id: OUTSIDER, name: "떠난학생" }];
  h.users = [{ id: TEACHER, display_name: "추민아" }, { id: OTHER, display_name: "김그린" }, { id: STRANGER, display_name: "옛담당" }];
});

describe("자리 몫 조정 저장", () => {
  it("반 전체 값 + 따로 정한 학생을 한 줄로 저장하고 감사로그를 남긴다(급여 갈래 · 학생별 값도 앞뒤로)", async () => {
    expect(await save({ units: 1, students: { [S2]: 0 } })).toEqual({ ok: true });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({
      op: "upsert", table: "attendance_seat_share_adjust",
      values: [{ ...KEY, teacher_id: TEACHER, units: 1, student_units: { [S2]: 0 }, updated_by: "admin" }],
      options: { onConflict: "tenant_id,class_id,period,teacher_id" },
    });
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "payroll_seat_share_set",
      metadata: {
        classId: CLASS, period: PERIOD, userId: TEACHER, units: 1, students: 1, studentUnits: { [S2]: 0 },
        before: { units: 0, students: 0, studentUnits: {} },
      },
    }));
  });

  it("빈 값(0 · 학생 없음)으로 바꾸면 줄을 지운다 · 같은 값은 다시 쓰지 않는다", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 1, students: {} }]]));
    expect(await save({ units: 1 })).toEqual({ ok: false, error: "바뀐 값이 없습니다" });
    expect(h.writes).toEqual([]);
    expect(await save({ units: 0 })).toEqual({ ok: true });
    expect(h.writes).toEqual([{ op: "delete", table: "attendance_seat_share_adjust", match: KEY, in: ["teacher_id", [TEACHER]] }]);
    expect(h.log.mock.calls[0]![0].metadata.before).toEqual({ units: 1, students: 0, studentUnits: {} });
  });

  it("🔴 학생별 값만 바꾼 저장도 로그에 앞뒤가 남는다(반 전체 값은 그대로)", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 0, students: { [S1]: 0.5 } }]]));
    expect(await save({ units: 0, students: { [S1]: 5 } })).toEqual({ ok: true });
    expect(h.log.mock.calls[0]![0].metadata).toMatchObject({ units: 0, studentUnits: { [S1]: 5 }, before: { units: 0, studentUnits: { [S1]: 0.5 } } });
  });

  it("🔴 권한 없음 · 깨진 값은 쓰지 않는다", async () => {
    h.gate.mockResolvedValue(null);
    expect((await save()).ok).toBe(false);
    h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant" });
    for (const bad of [{ teacherId: "x" }, { units: 0.3 }, { units: -1 }, { units: "abc" }, { students: { [S1]: 0.3 } }, { students: { nope: 1 } }, { students: [1] }]) {
      expect((await save(bad)).ok, JSON.stringify(bad)).toBe(false);
    }
    expect((await saveAll([entry()], { classId: "x" })).ok).toBe(false);
    expect((await saveAll([entry()], { period: "2026-13" })).ok).toBe(false);
    expect((await saveAll([])).ok).toBe(false);
    expect((await saveAll("nope" as never)).ok).toBe(false);
    expect((await saveAll([entry(), entry({ units: 2 })])).ok, "같은 선생님을 두 번").toBe(false);
    expect(h.writes).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 그 달 그 반을 맡지 않은 선생님 · 그 반 수강생이 아닌 학생은 거절한다(요청을 지어 보내도) — 누구 값인지 함께 돌려준다", async () => {
    expect(await save({ teacherId: STRANGER })).toEqual({ ok: false, error: "이 반을 맡은 선생님에게만 돌릴 수 있습니다", teacherId: STRANGER });
    expect(await save({ students: { [OUTSIDER]: 1 } })).toEqual({ ok: false, error: "그 달 이 반 수강생만 따로 정할 수 있습니다", teacherId: TEACHER });
    // 한 명이라도 걸리면 아무도 저장하지 않는다.
    expect(await saveAll([entry(), entry({ teacherId: STRANGER })])).toMatchObject({ ok: false, teacherId: STRANGER });
    expect(h.writes).toEqual([]);
    // 교시 담당(담임 아님)은 받을 수 있다.
    expect(await save({ teacherId: OTHER })).toEqual({ ok: true });
    expect(h.writes).toHaveLength(1);
  });

  it("🔴 더는 맡지 않는 선생님의 남은 값은 줄이거나 지울 수 있다 — 안 그러면 다른 선생님 몫까지 영영 막힌다(늘리기는 거절)", async () => {
    h.read.mockResolvedValue(new Map([[STRANGER, { units: 3, students: {} }]]));
    expect(await save({ teacherId: STRANGER, units: 4 })).toMatchObject({ ok: false, error: "이 반을 맡은 선생님에게만 돌릴 수 있습니다" });
    expect(await save({ teacherId: STRANGER, units: 3, students: { [S1]: 4 } })).toMatchObject({ ok: false });
    expect(h.writes).toEqual([]);
    expect(await save({ teacherId: STRANGER, units: 1 })).toEqual({ ok: true });
    expect(await save({ teacherId: STRANGER, units: 0 })).toEqual({ ok: true });
    expect(h.writes.map((w) => w.op)).toEqual(["upsert", "delete"]);
  });

  it("🔴 명단에서 빠진 학생의 남은 값은 그대로 두거나 줄이거나 지울 수 있다 — 그 선생님 줄이 통째로 굳지 않는다(새로 적기·늘리기는 거절)", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 1, students: { [OUTSIDER]: 2 } }]]));
    // 남은 값을 그대로 둔 채 반 전체 값만 고친다(창이 그 값을 함께 실어 보낸다).
    expect(await save({ units: 0, students: { [OUTSIDER]: 2 } })).toEqual({ ok: true });
    expect(await save({ units: 1, students: { [OUTSIDER]: 1 } })).toEqual({ ok: true });
    expect(await save({ units: 1, students: {} })).toEqual({ ok: true });
    expect(await save({ units: 1, students: { [OUTSIDER]: 2.5 } })).toMatchObject({ ok: false, error: "그 달 이 반 수강생만 따로 정할 수 있습니다" });
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 1, students: {} }]]));
    expect(await save({ units: 1, students: { [OUTSIDER]: 0 } })).toMatchObject({ ok: false });
    expect(h.writes).toHaveLength(3);
  });

  it("🔴 자리 몫보다 많이는 못 돌린다 — 같은 반 다른 선생님이 가져간 값까지 합쳐 본다(학생별 값 포함)", async () => {
    expect(await save({ units: 6 })).toEqual({ ok: false, error: "이 달 자리 몫 5시수보다 많이 돌릴 수 없습니다" });
    expect(await save({ units: 1, students: { [S1]: 6 } })).toMatchObject({ ok: false });
    h.read.mockResolvedValue(new Map([[OTHER, { units: 0, students: { [S1]: 4 } }]]));
    expect(await save({ units: 2 })).toMatchObject({ ok: false });
    expect(await save({ units: 1 })).toEqual({ ok: true });
    // 자리 교시가 없는 달(자리 몫 0)은 돌릴 것이 없다.
    h.plan.mockResolvedValue(plan(0));
    h.read.mockResolvedValue(new Map());
    expect(await save({ units: 0.5 })).toEqual({ ok: false, error: "이 달 이 반에는 돌릴 자리 몫이 없습니다" });
  });

  it("🔴 두 선생님 값을 맞바꾸는 저장은 통과한다 — 최종 상태로 보고 한 문장으로 쓴다(한 명씩 보면 순서 때문에 거절된다)", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 2, students: {} }], [OTHER, { units: 3, students: {} }]]));
    expect(await saveAll([entry({ units: 3 }), entry({ teacherId: OTHER, units: 2 })])).toEqual({ ok: true });
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]!.values).toMatchObject([{ teacher_id: TEACHER, units: 3 }, { teacher_id: OTHER, units: 2 }]);
    expect(h.log).toHaveBeenCalledTimes(2);
    // 합이 늘어 자리 몫을 넘는 맞바꾸기는 거절(아무것도 안 쓴다).
    h.writes = [];
    expect(await saveAll([entry({ units: 3 }), entry({ teacherId: OTHER, units: 3 })])).toMatchObject({ ok: false, error: "이 달 자리 몫 5시수보다 많이 돌릴 수 없습니다" });
    expect(h.writes).toEqual([]);
  });

  it("여러 선생님을 한 번에 — 안 바뀐 선생님은 건너뛰고, 지울 줄을 먼저 지운 뒤 나머지를 한 문장으로 쓴다", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 2, students: {} }], [OTHER, { units: 1, students: {} }]]));
    expect(await saveAll([entry({ units: 0 }), entry({ teacherId: OTHER, units: 1 })])).toEqual({ ok: true });
    expect(h.writes).toEqual([{ op: "delete", table: "attendance_seat_share_adjust", match: KEY, in: ["teacher_id", [TEACHER]] }]);
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ metadata: expect.objectContaining({ userId: TEACHER, units: 0 }) }));
    h.writes = [];
    expect(await saveAll([entry({ units: 0 }), entry({ teacherId: OTHER, units: 3 })])).toEqual({ ok: true });
    expect(h.writes.map((w) => w.op)).toEqual(["delete", "upsert"]);
  });

  it("줄이는 저장은 자리 몫을 넘은 상태에서도 받는다(시간표가 바뀐 뒤 고칠 수 있어야 한다)", async () => {
    h.plan.mockResolvedValue(plan(1));
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 3, students: {} }]]));
    expect(await save({ units: 2 })).toEqual({ ok: true });
    expect(h.plan).not.toHaveBeenCalled();
  });

  it("표가 아직 없으면(앱이 SQL보다 먼저 나간 사이) 준비 중이라고 말한다 · 그 밖의 쓰기 오류는 이유와 함께 실패", async () => {
    h.read.mockRejectedValue({ code: "PGRST205", message: "Could not find the table" });
    expect(await save()).toEqual({ ok: false, error: "자리 몫을 조정하는 기능이 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요" });
    h.read.mockResolvedValue(new Map());
    h.writeError = { code: "42501", message: "permission denied" };
    const result = await save();
    expect(result.ok).toBe(false);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 뒤 문장(넣기)만 실패해도 이미 지운 줄은 감사로그에 남는다 — 급여 상한이 바뀐 삭제가 기록 없이 사라지지 않는다", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 2, students: {} }]]));
    h.writeError = (w: Write) => (w.op === "upsert" ? { code: "42501", message: "permission denied" } : null);
    expect((await saveAll([entry({ units: 0 }), entry({ teacherId: OTHER, units: 1 })])).ok).toBe(false);
    expect(h.writes.map((w) => w.op)).toEqual(["delete", "upsert"]);
    // 지운 줄(합이 줄어드는 쪽이라 자리 몫을 넘지 않는다)만 로그에 남고, 실패한 넣기는 남지 않는다.
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      metadata: expect.objectContaining({ userId: TEACHER, units: 0, before: { units: 2, students: 0, studentUnits: {} } }),
    }));
  });

  it("🔴 그 달 이 반에서 수업 몫이 없는 선생님에게는 못 돌린다(어느 줄에도 실리지 않는 값) — 남은 값을 줄이거나 지우는 것은 받는다", async () => {
    // 담임인데 이름 붙은 교시가 없는 달: 계획 몫이 교시 담당 4 · 자리 5뿐이다.
    h.plan.mockResolvedValue(Object.assign(new Map([[OTHER, 4], ["", 5]]), { homeroomTeacherId: TEACHER }));
    expect(await save({ units: 1 })).toEqual({ ok: false, error: "이 달 이 반에서 수업 몫이 없는 선생님에게는 돌릴 수 없습니다", teacherId: TEACHER });
    // 한 명이라도 걸리면 함께 보낸 선생님도 저장하지 않는다.
    expect(await saveAll([entry({ teacherId: OTHER, units: 1 }), entry({ units: 1 })])).toMatchObject({ ok: false, teacherId: TEACHER });
    expect(h.writes).toEqual([]);
    expect(await save({ teacherId: OTHER, units: 1 })).toEqual({ ok: true });
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 2, students: {} }]]));
    expect(await save({ units: 3 })).toMatchObject({ ok: false, teacherId: TEACHER });
    expect(await save({ units: 1 })).toEqual({ ok: true });
    expect(await save({ units: 0 })).toEqual({ ok: true });
    expect(h.writes.map((w) => w.op)).toEqual(["upsert", "upsert", "delete"]);
  });
});

describe("자리 몫 창 재료", () => {
  it("그 달 계획 몫(선생님 · 자리)과 지금 조정값 · 그 달 수강생을 싣는다", async () => {
    h.read.mockResolvedValue(new Map([[TEACHER, { units: 1, students: { [S2]: 0 } }]]));
    const result = await loadSeatShareSheet({ classId: CLASS, period: PERIOD });
    expect(result).toEqual({ ok: true, sheet: {
      classId: CLASS, period: PERIOD, seat: 5,
      teachers: [
        { id: TEACHER, name: "추민아", planned: 19, units: 1, students: { [S2]: 0 }, assigned: true },
        { id: OTHER, name: "김그린", planned: 4, units: 0, students: {}, assigned: true },
      ],
      students: [{ id: S2, name: "가학생" }, { id: S1, name: "나학생" }],
    } });
  });

  it("🔴 값이 남은 옛 담당 · 명단에서 빠진 학생도 싣는다(표시와 함께) — 안 보이면 지울 수도 없다", async () => {
    h.read.mockResolvedValue(new Map([[STRANGER, { units: 3, students: { [OUTSIDER]: 2 } }]]));
    const result = await loadSeatShareSheet({ classId: CLASS, period: PERIOD });
    if (!result.ok) throw new Error(result.error);
    expect(result.sheet.teachers.map((t) => [t.name, t.assigned, t.units])).toEqual([["추민아", true, 0], ["김그린", true, 0], ["옛담당", false, 3]]);
    expect(result.sheet.students).toEqual([{ id: S2, name: "가학생" }, { id: S1, name: "나학생" }, { id: OUTSIDER, name: "떠난학생", gone: true }]);
  });

  it("🔴 권한 없음 · 깨진 요청 · 모르는 반 · 표 없음은 이유를 말하고 재료를 주지 않는다", async () => {
    h.gate.mockResolvedValue(null);
    expect((await loadSeatShareSheet({ classId: CLASS, period: PERIOD })).ok).toBe(false);
    h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant" });
    expect((await loadSeatShareSheet({ classId: "x", period: PERIOD })).ok).toBe(false);
    h.facts.mockResolvedValue(new Map());
    expect(await loadSeatShareSheet({ classId: CLASS, period: PERIOD })).toEqual({ ok: false, error: "이 반을 찾을 수 없습니다" });
    h.facts.mockResolvedValue(new Map([[CLASS, { homeroomTeacherId: TEACHER, slots: [] }]]));
    h.read.mockRejectedValue({ code: "42P01" });
    expect(await loadSeatShareSheet({ classId: CLASS, period: PERIOD })).toMatchObject({ ok: false, error: expect.stringContaining("아직 준비되지") });
  });
});
