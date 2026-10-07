import { beforeEach, describe, expect, it, vi } from "vitest";

// JJ실 시수 넘기기(원장 2026-10-07)의 서버 게이트 — 규칙은 seat-transfer.test.ts가 본다.
const h = vi.hoisted(() => ({
  gate: vi.fn(), ready: vi.fn(), facts: vi.fn(), log: vi.fn(),
  rows: [] as Record<string, unknown>[], readError: null as unknown, writeError: null as unknown,
  updates: [] as { values: Record<string, unknown>; ids: string[]; tenant: unknown }[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: h.log }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("./salary-rates", () => ({ requireAttendanceSalaryAdmin: h.gate }));
vi.mock("./scope-ownership", () => ({ loadScopeFacts: h.facts }));
vi.mock("./taught-by-db", () => ({ taughtByColumnReady: h.ready }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | null = null;
      let ids: string[] = [];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (col: string, v: unknown) => { filters[col] = v; return b; };
      b.in = (_col: string, v: string[]) => { ids = v; return b; };
      b.update = (v: Record<string, unknown>) => { values = v; return b; };
      b.then = (resolve: (v: unknown) => unknown) => {
        if (values) { h.updates.push({ values, ids, tenant: filters.tenant_id }); return Promise.resolve({ error: h.writeError }).then(resolve); }
        return Promise.resolve({ data: h.readError ? null : h.rows, error: h.readError }).then(resolve);
      };
      return b;
    },
  }),
}));

import { transferSeatUnits } from "./seat-transfer-actions";

const CLASS = "aaaaaaaa-1111-4111-8111-111111111111";
const STUDENT = "bbbbbbbb-2222-4222-8222-222222222222";
const TEACHER = "cccccccc-3333-4333-8333-333333333333";
const OTHER = "dddddddd-4444-4444-8444-444444444444";
const DATE = "2026-10-07"; // 수요일
const input = (over: Record<string, unknown> = {}) => ({ classId: CLASS, studentId: STUDENT, date: DATE, teacherId: TEACHER, take: true, ...over }) as never;
const slot = (startTime: string, over: Record<string, unknown> = {}) => ({ dayOfWeek: "wed", startTime, teacherId: null, slotTeacherLabel: null, validFrom: "2026-09-01", validTo: null, ...over });
const record = (id: string, over: Record<string, unknown> = {}) => ({ id, slot_start: "17:20", seat_label: null, recorded_via: "seat", taught_by: null, status: "present", session_units: null, recorded_at: "2026-10-07T09:00:00Z", ...over });

beforeEach(() => {
  vi.clearAllMocks(); h.updates = []; h.readError = null; h.writeError = null;
  h.gate.mockResolvedValue({ id: "admin", tenantId: "tenant", systemRole: "admin" });
  h.ready.mockResolvedValue(true);
  // 담임 수업 16:20 · JJ실 17:20 · 랩실 18:20
  h.facts.mockResolvedValue(new Map([[CLASS, { homeroomTeacherId: TEACHER, slots: [slot("16:20", { teacherId: TEACHER }), slot("17:20", { slotTeacherLabel: "JJ" }), slot("18:20", { slotTeacherLabel: "LAB" })] }]]));
  h.rows = [record("r-jj"), record("r-own", { slot_start: "16:20", recorded_via: null }), record("r-lab", { slot_start: "18:20", seat_label: "LAB" })];
});

describe("JJ실 시수 넘기기", () => {
  it("JJ실 기록만 그 선생님 몫으로 돌린다 — 담임 수업·랩실 행은 그대로(JJ −1 · 선생님 +1)", async () => {
    const result = await transferSeatUnits(input());
    expect(result).toEqual({ ok: true, units: { avail: 0, taken: 1, others: 0 }, moved: 1 });
    expect(h.updates).toEqual([{ values: { taught_by: TEACHER }, ids: ["r-jj"], tenant: "tenant" }]);
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "payroll_jj_units_take", metadata: expect.objectContaining({ classId: CLASS, studentId: STUDENT, userId: TEACHER, date: DATE, units: 1 }) }));
  });

  it("되돌리기 — 이 선생님이 넘겨받은 JJ실 기록만 방 몫으로", async () => {
    h.rows = [record("r-jj", { taught_by: TEACHER }), record("r-makeup", { slot_start: "16:20", recorded_via: null, taught_by: TEACHER })];
    const result = await transferSeatUnits(input({ take: false }));
    expect(result).toMatchObject({ ok: true, units: { avail: 1, taken: 0, others: 0 }, moved: 1 });
    // 🔴 대신 보강 귀속이 걸린 사람 수업 행(r-makeup)은 건드리지 않는다.
    expect(h.updates).toEqual([{ values: { taught_by: null }, ids: ["r-jj"], tenant: "tenant" }]);
    expect(h.log).toHaveBeenCalledWith(expect.objectContaining({ action: "payroll_jj_units_return" }));
  });

  it("같은 교시의 옛 정정 행까지 함께 고친다 — 판정·시수는 가장 최근 행으로", async () => {
    h.rows = [record("r-new", { session_units: 1.5 }), record("r-old", { status: "absent", recorded_at: "2026-10-07T08:00:00Z" })];
    const result = await transferSeatUnits(input());
    expect(result).toMatchObject({ ok: true, moved: 1.5 });
    expect(h.updates[0]!.ids).toEqual(["r-new", "r-old"]);
  });

  it("🔴 다른 선생님이 이미 넘겨받은 시수는 뺏지 않는다", async () => {
    h.rows = [record("r-jj", { taught_by: OTHER })];
    const result = await transferSeatUnits(input());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("이미 다른 선생님 몫");
    expect(h.updates).toEqual([]);
  });

  it("넘길 JJ실 기록이 없는 칸(담임 수업·랩실뿐)은 거절한다", async () => {
    h.rows = [record("r-own", { slot_start: "16:20", recorded_via: null }), record("r-lab", { slot_start: "18:20", seat_label: "LAB" })];
    const result = await transferSeatUnits(input());
    expect(result).toMatchObject({ ok: false, error: "이 칸에 넘길 수 있는 JJ실 기록이 없습니다" });
    expect(h.updates).toEqual([]);
    expect(h.log).not.toHaveBeenCalled();
  });

  it("🔴 권한 보유자 전용 — 급여 비율을 고칠 수 없는 사람·열람 전용 보기는 아무것도 읽지 않는다", async () => {
    h.gate.mockResolvedValue(null);
    const result = await transferSeatUnits(input());
    expect(result.ok).toBe(false);
    expect(h.facts).not.toHaveBeenCalled();
    expect(h.updates).toEqual([]);
  });

  it("🔴 그 선생님이 그 달에 맡지 않은 반으로는 넘길 수 없다", async () => {
    const result = await transferSeatUnits(input({ teacherId: OTHER }));
    expect(result).toMatchObject({ ok: false, error: "이 선생님이 그 달에 맡은 반이 아닙니다" });
    h.facts.mockResolvedValue(new Map()); // 남의 학원 반 — 재료가 없다
    expect((await transferSeatUnits(input())).ok).toBe(false);
    expect(h.updates).toEqual([]);
  });

  it("잘못된 입력 · 귀속 칸 미준비 · 조회·저장 실패는 한글 안내로 거절한다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await transferSeatUnits(input({ date: "10/7" }))).ok).toBe(false);
    expect((await transferSeatUnits(input({ classId: "x" }))).ok).toBe(false);
    expect((await transferSeatUnits(input({ take: "yes" }))).ok).toBe(false);
    h.ready.mockResolvedValue(false);
    expect((await transferSeatUnits(input())).error).toContain("아직 준비되지 않았습니다");
    h.ready.mockResolvedValue(true);
    h.readError = { message: "timeout" };
    expect((await transferSeatUnits(input())).error).toMatch(/[가-힣]/);
    h.readError = null;
    h.writeError = { code: "42501", message: "permission denied for table attendance_records" };
    const failed = await transferSeatUnits(input());
    expect(failed.ok).toBe(false);
    expect(failed.error).not.toContain("attendance_records");
    expect(h.log).not.toHaveBeenCalled();
    spy.mockRestore(); warn.mockRestore();
  });
});
