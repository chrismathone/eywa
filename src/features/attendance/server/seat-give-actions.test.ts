import { beforeEach, describe, expect, it, vi } from "vitest";

// 회차 확정 JJ실 줄의 서버 문(원장 2026-10-07 "회차 확정에 JJ반이 생기면 거기서 주면") — 규칙은 seat-give.test.ts가 본다.
const h = vi.hoisted(() => ({
  gate: vi.fn(), ready: vi.fn(), facts: vi.fn(), log: vi.fn(),
  rows: [] as Record<string, unknown>[], readError: null as unknown, writeError: null as unknown,
  updates: [] as { values: Record<string, unknown>; ids: string[]; tenant: unknown }[],
  reads: [] as Record<string, unknown>[],
  students: [] as { id: string; name: string }[], users: [] as { id: string; display_name: string | null }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.in = () => b;
      b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: table === "students" ? h.students : h.users, error: null }).then(resolve);
      return b;
    },
  }),
}));
vi.mock("./salary-rates", () => ({ attendanceSalaryAdminOrNull: h.gate }));
vi.mock("./scope-ownership", () => ({ loadScopeFacts: h.facts }));
vi.mock("./taught-by-db", () => ({ taughtByColumnReady: h.ready }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      let ids: string[] = [];
      let range: [number, number] | null = null;
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, v: unknown) => { filters[col] = v; return b; };
      b.gte = (col: string, v: unknown) => { filters[`${col}>=`] = v; return b; };
      b.lte = (col: string, v: unknown) => { filters[`${col}<=`] = v; return b; };
      b.in = (_col: string, v: string[]) => { ids = v; return b; };
      b.range = (f: number, t: number) => { range = [f, t]; return b; };
      b.update = (v: Record<string, unknown>) => { values = v; return b; };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (values) { h.updates.push({ values, ids, tenant: filters.tenant_id }); return Promise.resolve({ error: h.writeError }).then(resolve); }
        h.reads.push({ ...filters });
        const page = range ? h.rows.slice(range[0], range[1] + 1) : h.rows;
        return Promise.resolve({ data: h.readError ? null : page, error: h.readError }).then(resolve);
      };
      return b;
    },
  }),
}));

import { loadSeatGiveSheet, saveSeatGives } from "./seat-give-actions";

const CLASS = "aaaaaaaa-1111-4111-8111-111111111111";
const S1 = "bbbbbbbb-2222-4222-8222-222222222221";
const S2 = "bbbbbbbb-2222-4222-8222-222222222222";
const TEACHER = "cccccccc-3333-4333-8333-333333333333";
const OTHER = "dddddddd-4444-4444-8444-444444444444";
const STRANGER = "eeeeeeee-5555-4555-8555-555555555555";
const PERIOD = "2026-10";
const D1 = "2026-10-07"; // 수요일
const D2 = "2026-10-14"; // 수요일
const slot = (startTime: string, over: Record<string, unknown> = {}) => ({ dayOfWeek: "wed", startTime, teacherId: null, slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null, ...over });
const record = (id: string, over: Record<string, unknown> = {}) => ({
  id, student_id: S1, session_date: D1, slot_start: "17:20", seat_label: null, recorded_via: "seat", taught_by: null, status: "present",
  session_units: null, recorded_at: "2026-10-07T09:00:00Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks(); h.updates = []; h.reads = []; h.readError = null; h.writeError = null;
  h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" });
  h.ready.mockResolvedValue(true);
  // 담임(TEACHER) 16:20 · 교시 담당(OTHER) 15:20 · JJ실 17:20 · 랩실 18:20
  h.facts.mockResolvedValue(new Map([[CLASS, { homeroomTeacherId: TEACHER, slots: [
    slot("15:20", { teacherId: OTHER }), slot("16:20", { teacherId: TEACHER }), slot("17:20", { slotTeacherLabel: "JJ" }), slot("18:20", { slotTeacherLabel: "LAB" }),
  ] }]]));
  h.rows = [
    record("jj-s1-d1"),
    record("jj-s2-d1", { student_id: S2 }),
    record("jj-s1-d2", { session_date: D2, taught_by: TEACHER }),
    record("own", { slot_start: "16:20", recorded_via: null }),
    record("lab", { slot_start: "18:20", seat_label: "LAB" }),
  ];
  h.students = [{ id: S2, name: "나학생" }, { id: S1, name: "가학생" }];
  h.users = [{ id: TEACHER, display_name: "추민아" }, { id: OTHER, display_name: "김그린" }];
});

describe("JJ실 줄 — 날짜별 표 읽기", () => {
  it("그 달 JJ실 기록만 날짜 × 학생으로 편다 — 사람 수업·랩실은 없다, 받을 수 있는 선생님은 담임 + 그 달 교시 담당", async () => {
    const result = await loadSeatGiveSheet({ classId: CLASS, period: PERIOD });
    expect(result).toEqual({ ok: true, sheet: {
      classId: CLASS, period: PERIOD, dates: [D1, D2],
      students: [{ id: S1, name: "가학생" }, { id: S2, name: "나학생" }],
      cells: { [S1]: { [D1]: { units: 1, holder: null }, [D2]: { units: 1, holder: TEACHER } }, [S2]: { [D1]: { units: 1, holder: null } } },
      teachers: [{ id: TEACHER, name: "추민아" }, { id: OTHER, name: "김그린" }],
      names: { [TEACHER]: "추민아", [OTHER]: "김그린" },
    } });
    // 🔴 지점 · 반 · 그 달(달력월)로 좁혀 읽는다(admin 클라이언트라 RLS가 대신 걸러 주지 않는다).
    expect(h.reads[0]).toEqual({ tenant_id: "tenant", class_id: CLASS, "session_date>=": "2026-10-01", "session_date<=": "2026-10-31" });
  });

  it("🔴 권한이 없으면 읽지도 않는다 · 반을 못 찾으면 그렇게 말한다", async () => {
    h.gate.mockResolvedValue(null);
    expect(await loadSeatGiveSheet({ classId: CLASS, period: PERIOD })).toEqual({ ok: false, error: "급여 비율을 설정할 수 있는 사람만 JJ실 시수를 줄 수 있습니다" });
    expect(h.reads).toEqual([]);
    h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant" });
    h.facts.mockResolvedValue(new Map());
    expect(await loadSeatGiveSheet({ classId: CLASS, period: PERIOD })).toEqual({ ok: false, error: "이 반을 찾을 수 없습니다" });
    expect((await loadSeatGiveSheet({ classId: "x", period: PERIOD })).ok).toBe(false);
    expect((await loadSeatGiveSheet({ classId: CLASS, period: "2026-13" })).ok).toBe(false);
  });
});

describe("JJ실 줄 — 주기 · 되돌리기 저장", () => {
  it("고른 날짜의 JJ실 행만 그 선생님 몫으로 — 반 전원(JJ −N · 선생님 +N), 감사로그 한 줄", async () => {
    const result = await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D1, teacherId: TEACHER }, { studentId: S2, date: D1, teacherId: TEACHER }] });
    expect(result).toEqual({ ok: true, changed: 2, units: 2, missing: 0 });
    expect(h.updates).toEqual([{ values: { taught_by: TEACHER }, ids: ["jj-s1-d1", "jj-s2-d1"], tenant: "tenant" }]);
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      action: "payroll_jj_units_take",
      metadata: { classId: CLASS, dates: [D1], date: D1, students: 2, units: 2, userId: TEACHER },
    }));
  });

  it("되돌리기(JJ실 그대로) — 그 선생님이 받은 JJ실 행만 · 다른 선생님으로 바꾸면 되돌림과 줌 두 줄", async () => {
    expect(await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D2, teacherId: null }] })).toMatchObject({ ok: true, changed: 1, units: 1 });
    expect(h.updates).toEqual([{ values: { taught_by: null }, ids: ["jj-s1-d2"], tenant: "tenant" }]);
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "payroll_jj_units_return", metadata: expect.objectContaining({ userId: TEACHER, dates: [D2] }) }));
    h.log.mockClear(); h.updates = [];
    expect((await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D2, teacherId: OTHER }] })).ok).toBe(true);
    expect(h.updates).toEqual([{ values: { taught_by: OTHER }, ids: ["jj-s1-d2"], tenant: "tenant" }]);
    expect(h.log.mock.calls.map((c) => [c[0].action, c[0].metadata.userId])).toEqual([["payroll_jj_units_return", TEACHER], ["payroll_jj_units_take", OTHER]]);
  });

  it("🔴 그 반을 맡지 않은 선생님에게는 못 준다 — 화면의 선택지 밖을 지어 보내도 여기서 걸린다", async () => {
    expect(await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D1, teacherId: STRANGER }] })).toEqual({ ok: false, error: "이 반을 맡은 선생님에게만 줄 수 있습니다" });
    expect(h.updates).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 권한 없음 · 그 달 밖 날짜 · 깨진 값은 쓰지 않는다", async () => {
    h.gate.mockResolvedValue(null);
    expect((await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D1, teacherId: TEACHER }] })).ok).toBe(false);
    h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant" });
    for (const bad of [
      [{ studentId: S1, date: "2026-11-01", teacherId: TEACHER }], // 그 달 밖
      [{ studentId: "x", date: D1, teacherId: TEACHER }],
      [{ studentId: S1, date: D1, teacherId: "x" }],
      [],
    ]) {
      expect((await saveSeatGives({ classId: CLASS, period: PERIOD, changes: bad as never })).ok).toBe(false);
    }
    expect(h.updates).toEqual([]);
  });

  it("이미 그 몫인 칸은 다시 쓰지 않는다 · 그사이 기록이 사라진 칸은 이유를 말한다", async () => {
    expect(await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D2, teacherId: TEACHER }] })).toEqual({ ok: false, error: "바뀐 칸이 없습니다", missing: 0 });
    expect(await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S2, date: D2, teacherId: TEACHER }] })).toMatchObject({ ok: false, missing: 1 });
    expect(h.updates).toEqual([]);
  });

  it("이름 조회에서 빠진 학생도 줄로 선다 — 표에서 말없이 사라지면 '그 날 전원'에서도 빠진다", async () => {
    h.students = [{ id: S1, name: "가학생" }]; // S2의 이름이 안 왔다
    const result = await loadSeatGiveSheet({ classId: CLASS, period: PERIOD });
    expect(result.ok && result.sheet.students).toEqual([{ id: S1, name: "가학생" }, { id: S2, name: "이름 없음" }]);
  });

  it("🔴 교시마다 몫이 다르던 칸을 JJ실로 되돌려도 감사로그가 남는다(그 선생님 몫에서 되돌림)", async () => {
    h.rows = [record("m1", { taught_by: TEACHER }), record("m2", { slot_start: "18:20" })];
    // 18:20도 JJ실 교시인 날 — 한 칸에 JJ 교시가 둘이고 몫이 갈려 있다.
    h.facts.mockResolvedValue(new Map([[CLASS, { homeroomTeacherId: TEACHER, slots: [slot("16:20", { teacherId: TEACHER }), slot("17:20", { slotTeacherLabel: "JJ" }), slot("18:20", { slotTeacherLabel: "JJ" })] }]]));
    expect(await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D1, teacherId: null }] })).toMatchObject({ ok: true, changed: 1, units: 1 });
    expect(h.updates).toEqual([{ values: { taught_by: null }, ids: ["m1"], tenant: "tenant" }]);
    expect(h.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: "payroll_jj_units_return", metadata: expect.objectContaining({ userId: TEACHER, units: 1 }) }));
  });

  it("저장이 실패하면 한글 안내를 돌려주고 감사로그는 남기지 않는다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.writeError = { code: "XX000", message: "boom" };
    const result = await saveSeatGives({ classId: CLASS, period: PERIOD, changes: [{ studentId: S1, date: D1, teacherId: TEACHER }] });
    expect(result.ok).toBe(false);
    expect(result.error).not.toContain("boom");
    expect(h.log).not.toHaveBeenCalled();
    spy.mockRestore(); warn.mockRestore();
  });
});
