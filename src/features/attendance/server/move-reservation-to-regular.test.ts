import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 보강 예약을 그날 정규 반으로 옮겨 합치기(원장 2026-10-27 박지호 건) — `moveReservationToRegular`.
 * 수요일 개별 JJ2L 결석분 보강(10/27 15:25~16:20)이 결석난 반 JJ2L로 잡혀, 화요일 BS2P 정규 보고서에 합칠 수 없었다.
 */
const JJ2L = "jj2l";
const BS2P = "bs2p";
const STUDENT = "jiho";
const DATE = "2026-10-27";

type Call = { table: string; op: "select" | "update"; filters: Record<string, unknown>; values?: Record<string, unknown> };
type Result = { data: unknown; error: { code?: string; message: string } | null };

const m = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1", systemRole: "teacher", displayName: "허주연" } as Record<string, unknown> | null,
  level: "all" as string,
  teaching: new Map<string, Set<string>>(),
  regularDay: true as boolean | null,
  block: null as string | null,
  admin: null as unknown,
  session: null as unknown,
  today: "2026-10-27",
  completed: new Map<string, number | null>(),
  log: vi.fn(),
  complete: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true, accessLevelTenant: async () => m.level }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => m.session }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: {} }) }));
vi.mock("@/features/owner/server/lesson-profile", () => ({ getLessonProfile: async () => ({ autoUnits: true }) }));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<typeof import("@/lib/date-kst")>()), kstToday: () => m.today }));
vi.mock("@/features/attendance/live/server/write-policy", () => ({
  userTaughtClassSet: async (_s: unknown, _u: string, date: string) => m.teaching.get(date) ?? new Set<string>(),
}));
vi.mock("@/features/makeups/server/adapters/gates", () => ({
  mappedReservationMutationBlock: async () => m.block,
  mappedCancelCommand: (id: string) => ({ reservationId: id, action: "cancel" }),
  mappedRescheduleCommand: (id: string) => ({ reservationId: id, action: "reschedule" }),
}));
vi.mock("./actions", () => ({ setAttendanceCell: vi.fn() }));
vi.mock("./makeup-reservation-complete", () => ({
  isRegularLessonDay: async () => m.regularDay,
  completeMakeupReservations: async (...args: unknown[]) => {
    m.complete(...args);
    return m.completed;
  },
  completionKey: (c: { studentId: string; classId: string; date: string }) => `${c.studentId}|${c.classId}|${c.date}`,
}));

import { moveReservationToRegular } from "./makeup-reservation-actions";

/** `from(t).select/update().eq().in()…` — 끝(await·maybeSingle)에서 handler가 결과를 정한다. 부른 순서대로 `calls`에 남는다. */
function fake(handler: (c: Call) => Result) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: "select", filters: {} };
      const finish = (single: boolean) => {
        calls.push(call);
        const r = handler(call);
        return Promise.resolve(single ? { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error } : r);
      };
      const b: Record<string, unknown> = {
        select: () => b,
        update: (v: Record<string, unknown>) => {
          call.op = "update";
          call.values = v;
          return b;
        },
        eq: (k: string, v: unknown) => {
          call.filters[k] = v;
          return b;
        },
        in: (k: string, v: unknown) => {
          call.filters[`${k}:in`] = v;
          return b;
        },
        lte: () => b,
        or: () => b,
        order: () => b,
        maybeSingle: () => finish(true),
        then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => finish(false).then(ok, err),
      };
      return b;
    },
  };
  return { client, calls };
}

const reservation = (over: Record<string, unknown> = {}) => ({
  id: "r1", student_id: STUDENT, class_id: JJ2L, absence_date: "2026-10-21", makeup_date: DATE,
  slot_start: "15:25:00", slot_end: "16:20:00", period_label: "1-2", note: "병결 보강", status: "reserved",
  created_by: "u1", report_mode: null, absence_class_id: null, ...over,
});

let state: {
  reservations: Record<string, unknown>[];
  fromDay: Record<string, unknown>[];
  updateFails: Set<string>;
  updateError: { code?: string; message: string } | null;
};
let admin: ReturnType<typeof fake>;
let session: ReturnType<typeof fake>;

beforeEach(() => {
  m.user = { id: "u1", tenantId: "t1", systemRole: "teacher", displayName: "허주연" };
  m.level = "all";
  m.teaching = new Map();
  m.regularDay = true;
  m.today = DATE;
  m.completed = new Map([[`${STUDENT}|${BS2P}|${DATE}`, 1.5]]);
  m.block = null;
  m.log.mockReset();
  m.complete.mockReset();
  state = { reservations: [reservation()], fromDay: [], updateFails: new Set(), updateError: null };
  admin = fake((c) => {
    if (c.table === "makeup_reservations" && c.op === "select") return { data: state.reservations, error: null };
    if (c.table === "makeup_reservations" && c.op === "update") {
      const id = c.filters.id as string;
      if (state.updateError && c.values?.report_mode === "merge") return { data: null, error: state.updateError };
      return { data: state.updateFails.has(id) && c.values?.report_mode === "merge" ? [] : [{ id }], error: null };
    }
    if (c.table === "classes") return { data: { subject: "math" }, error: null };
    if (c.table === "students") return { data: { name: "박지호" }, error: null };
    if (c.table === "attendance_records") return { data: state.fromDay, error: null };
    return { data: null, error: null };
  });
  session = fake((c) => {
    if (c.table === "enrollments") {
      return {
        data: [
          { class_id: JJ2L, start_date: "2026-10-07", end_date: null, on_hold: false, is_transferred: false },
          { class_id: BS2P, start_date: "2026-05-08", end_date: null, on_hold: false, is_transferred: false },
        ],
        error: null,
      };
    }
    if (c.table === "classes") {
      return {
        data: [
          { id: JJ2L, class_name: "초등M 개별 JJ2L", subject: "math", is_active: true, closed_at: null },
          { id: BS2P, class_name: "초등M 초6 BS2P", subject: "math", is_active: true, closed_at: null },
        ],
        error: null,
      };
    }
    return { data: null, error: null };
  });
  m.admin = admin.client;
  m.session = session.client;
});

const move = () => moveReservationToRegular({ studentId: STUDENT, date: DATE, fromClassId: JJ2L, toClassId: BS2P });
const updates = () => admin.calls.filter((c) => c.table === "makeup_reservations" && c.op === "update");

describe("moveReservationToRegular", () => {
  it("박지호 건 — 기록할 반 = BS2P · 결석난 반 = JJ2L · 합침, 이행은 '지금 값 + 보강분'으로(addToCurrent)", async () => {
    const res = await move();
    expect(res).toEqual({ ok: true, moved: 1, units: 1.5 });
    expect(updates()).toHaveLength(1);
    expect(updates()[0]!.values).toMatchObject({ class_id: BS2P, absence_class_id: JJ2L, report_mode: "merge" });
    // 🔴 이행 전 예약만 · 지금 그 반에 있는 것만(그 사이 바뀌었으면 0행)
    expect(updates()[0]!.filters).toMatchObject({ tenant_id: "t1", id: "r1", status: "reserved", class_id: JJ2L });
    // 🔴 이미 찍힌 칸 — 시간표로 다시 매기지 않고 지금 값 + 보강분(이행 모듈이 예약을 done으로 바꾼 호출에서만)
    expect(m.complete).toHaveBeenCalledWith({ tenantId: "t1" }, [
      expect.objectContaining({ studentId: STUDENT, classId: BS2P, date: DATE, unitsExplicit: false, created: false, addToCurrent: true }),
    ]);
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({
      action: "makeup_reserve_host_move", targetLabel: "박지호 · 초등M 초6 BS2P", metadata: expect.objectContaining({ units: 1.5 }),
    }));
  });

  it("🔴 출결 수정 기간이 지난 날짜는 강사(scoped)가 옮길 수 없다 — 시수는 급여 값(리뷰) · 관리자는 된다", async () => {
    m.level = "scoped";
    m.today = "2026-11-10";
    const res = await move();
    expect("error" in res && res.error).toMatch(/강사가 수정할 수 없습니다/);
    expect(admin.calls).toHaveLength(0);
    m.level = "all";
    expect(await move()).toMatchObject({ ok: true });
  });

  it("결석난 반이 곧 합칠 반이면 결석난 반 칸은 비운다(예약 창과 같은 행 모양)", async () => {
    state.reservations = [reservation({ absence_class_id: BS2P })];
    await move();
    expect(updates()[0]!.values).toMatchObject({ class_id: BS2P, absence_class_id: null });
  });

  it("출석이 아직이면 시수는 그대로 — 출석을 찍을 때 이행된다", async () => {
    m.completed = new Map();
    expect(await move()).toEqual({ ok: true, moved: 1 });
  });

  it("🔴 이행된 예약은 옮기지 않는다", async () => {
    state.reservations = [reservation({ status: "done" })];
    const res = await move();
    expect("error" in res && res.error).toMatch(/이미 기록된 반 출석부에 찍혀/);
    expect(updates()).toHaveLength(0);
  });

  it("🔴 기록된 반 출석부에 그날 보강이 이미 찍혀 있으면 막는다 — 옮기면 시수가 두 번 선다", async () => {
    state.fromDay = [{ id: "a1", student_id: STUDENT, class_id: JJ2L, session_date: DATE, slot_start: null, status: "makeup", note: null, recorded_at: "2026-10-27T07:00:00Z" }];
    const res = await move();
    expect("error" in res && res.error).toMatch(/이미 기록된 반 출석부에 찍혀/);
    expect(updates()).toHaveLength(0);
  });

  it("그날 합칠 반 정규 수업일이 아니면 · 확인 못 하면 막는다", async () => {
    m.regularDay = false;
    expect(await move()).toEqual({ error: "그날은 초등M 초6 BS2P 정규 수업일이 아니라 합칠 수 없습니다" });
    m.regularDay = null;
    expect("error" in (await move())).toBe(true);
    expect(updates()).toHaveLength(0);
  });

  it("학생이 그날 다니지 않는 반·다른 과목 반으로는 옮기지 않는다", async () => {
    const res = await moveReservationToRegular({ studentId: STUDENT, date: DATE, fromClassId: JJ2L, toClassId: "elsewhere" });
    expect("error" in res && res.error).toMatch(/합칠 반을 다시 확인/);
    expect(updates()).toHaveLength(0);
  });

  it("🔴 강사는 합칠 반을 그날 맡아야 하고, 예약을 다룰 수 있어야 한다(기록된 반 그날 담당 또는 결석난 반 결석일 담당)", async () => {
    m.level = "scoped";
    m.teaching = new Map([[DATE, new Set([JJ2L])]]);
    expect(await move()).toEqual({ error: "담당 반이 아닙니다" });
    m.teaching = new Map([[DATE, new Set([BS2P])]]);
    expect(await move()).toEqual({ error: "담당 반이 아닙니다" });
    // 허주연 = BS2P 그날 담당 + JJ2L 결석일(10/21) 담당
    m.teaching = new Map([[DATE, new Set([BS2P])], ["2026-10-21", new Set([JJ2L])]]);
    expect(await move()).toMatchObject({ ok: true });
  });

  it("보강관리에 연결된 예약은 그 안내로 막는다", async () => {
    m.block = "보강관리에서 바꿔 주세요";
    expect(await move()).toEqual({ error: "보강관리에서 바꿔 주세요" });
    expect(updates()).toHaveLength(0);
  });

  it("🔴 둘째 예약이 그 사이 바뀌면 먼저 옮긴 예약을 되돌린다(반쪽 상태 금지)", async () => {
    state.reservations = [reservation(), reservation({ id: "r2", slot_start: "16:20:00", slot_end: "17:15:00" })];
    state.updateFails = new Set(["r2"]);
    const res = await move();
    expect("error" in res && res.error).toMatch(/그 사이 예약이 바뀌어/);
    const undo = updates().filter((c) => c.values?.class_id === JJ2L);
    expect(undo.map((c) => c.filters.id)).toEqual(["r1"]);
    expect(undo[0]!.values).toMatchObject({ absence_class_id: null, report_mode: null });
    expect(m.complete).not.toHaveBeenCalled();
  });

  it("합칠 반에 같은 교시 예약이 이미 있으면(유니크) 사람 말로", async () => {
    state.updateError = { code: "23505", message: "dup" };
    expect(await move()).toEqual({ error: "초등M 초6 BS2P에 같은 교시 보강 예약이 이미 있습니다" });
  });

  it("옮길 예약이 없거나 요청이 잘못되면 막는다", async () => {
    state.reservations = [];
    expect("error" in (await move())).toBe(true);
    expect("error" in (await moveReservationToRegular({ studentId: STUDENT, date: DATE, fromClassId: BS2P, toClassId: BS2P }))).toBe(true);
    m.user = null;
    expect(await move()).toEqual({ error: "로그인이 필요합니다" });
  });
});
