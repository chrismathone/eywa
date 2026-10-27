import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 보강 진행 여부 확인(원장 2026-10-27 *"보강 예약을 누르면 보강을 했다 안했다 체크"*) — `checkMakeupReservation`.
 * 박지호 10/27: 10/21(수) JJ2L 결석분 보강을 BS2P(화 정규 16:20~)로 옮겼는데 BS2P 출석(15:16)이 먼저라 이행이 안 돌았다.
 */
const BS2P = "bs2p";
const JJ2L = "jj2l";
const STUDENT = "jiho";
const DATE = "2026-10-27";

type Call = { table: string; op: "select" | "update" | "delete"; cols?: string; filters: Record<string, unknown>; values?: Record<string, unknown> };
type Result = { data: unknown; error: { code?: string; message: string } | null };

const m = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1", systemRole: "teacher", displayName: "허주연" } as Record<string, unknown> | null,
  level: "all" as string,
  teaching: new Map<string, Set<string>>(),
  today: "2026-10-27",
  admin: null as unknown,
  session: null as unknown,
  completed: new Map<string, number | null>(),
  cellResult: { ok: true, autoUnits: 1.5 } as Record<string, unknown>,
  regularDay: true as boolean | null,
  autoUnits: true,
  log: vi.fn(),
  complete: vi.fn(),
  setCell: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: async () => true, accessLevelTenant: async () => m.level }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.admin }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => m.session }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.log }));
vi.mock("@/features/owner/server/queries", () => ({ getTenantSettings: async () => ({ operations: {} }) }));
vi.mock("@/features/owner/server/lesson-profile", () => ({ getLessonProfile: async () => ({ autoUnits: m.autoUnits }) }));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<typeof import("@/lib/date-kst")>()), kstToday: () => m.today }));
vi.mock("@/features/attendance/live/server/write-policy", () => ({
  userTaughtClassSet: async (_s: unknown, _u: string, date: string) => m.teaching.get(date) ?? new Set<string>(),
}));
vi.mock("@/features/makeups/server/adapters/gates", () => ({
  mappedReservationMutationBlock: async () => null,
  mappedCancelCommand: (id: string) => ({ reservationId: id, action: "cancel" }),
  mappedRescheduleCommand: (id: string) => ({ reservationId: id, action: "reschedule" }),
}));
vi.mock("./actions", () => ({
  setAttendanceCell: async (...args: unknown[]) => {
    m.setCell(...args);
    return m.cellResult;
  },
}));
vi.mock("./makeup-reservation-complete", () => ({
  isRegularLessonDay: async () => m.regularDay,
  completeMakeupReservations: async (...args: unknown[]) => {
    m.complete(...args);
    return m.completed;
  },
  completionKey: (c: { studentId: string; classId: string; date: string }) => `${c.studentId}|${c.classId}|${c.date}`,
}));

import { checkMakeupReservation } from "./makeup-reservation-actions";

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
        select: (cols: string) => {
          if (call.op === "select") call.cols = cols;
          return b;
        },
        update: (v: Record<string, unknown>) => {
          call.op = "update";
          call.values = v;
          return b;
        },
        delete: () => {
          call.op = "delete";
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
        is: (k: string, v: unknown) => {
          call.filters[`${k}:is`] = v;
          return b;
        },
        or: () => b,
        lte: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: () => finish(true),
        then: (ok: (v: unknown) => unknown, err: (e: unknown) => unknown) => finish(false).then(ok, err),
      };
      return b;
    },
  };
  return { client, calls };
}

const reservation = (over: Record<string, unknown> = {}) => ({
  id: "r1", student_id: STUDENT, class_id: BS2P, absence_date: "2026-10-21", makeup_date: DATE,
  slot_start: "15:25:00", slot_end: "16:20:00", period_label: "1-2", note: "병결 보강", status: "reserved",
  created_by: "u1", report_mode: "merge", absence_class_id: JJ2L, checked_at: null, ...over,
});
const att = (over: Record<string, unknown> = {}) => ({
  id: "a1", student_id: STUDENT, class_id: BS2P, session_date: DATE, slot_start: null, status: "present", note: null, recorded_at: "2026-10-27T06:16:53Z", ...over,
});

let state: {
  reservations: Record<string, unknown>[];
  readError: { message: string } | null;
  day: Record<string, unknown>[];
  stillReserved: { id: string }[];
  links: { id: string; attendance_record_id: string | null }[];
  cells: { id: string; slot_start: string | null; status: string; session_units: number | null; note: string | null }[];
  audit: { metadata: Record<string, unknown>; created_at: string }[];
  linkError: { message: string } | null;
  siblings: Record<string, unknown>[];
  absRows: { id: string; note: string | null }[];
};
let admin: ReturnType<typeof fake>;

beforeEach(() => {
  m.user = { id: "u1", tenantId: "t1", systemRole: "teacher", displayName: "허주연" };
  m.level = "all";
  m.teaching = new Map();
  m.today = DATE;
  m.completed = new Map([[`${STUDENT}|${BS2P}|${DATE}`, 1.5]]);
  m.cellResult = { ok: true, autoUnits: 1.5 };
  m.regularDay = true;
  m.autoUnits = true;
  m.log.mockReset();
  m.complete.mockReset();
  m.setCell.mockReset();
  state = {
    reservations: [reservation()], readError: null, day: [att()], stillReserved: [], links: [], cells: [], audit: [], siblings: [], linkError: null,
    absRows: [{ id: "abs", note: "병결\n10/27 보강 예정\n10/30 보강 예정" }],
  };
  admin = fake((c) => {
    if (c.table === "makeup_reservations" && c.op === "select") {
      if (c.cols?.includes("absence_date") && c.cols.includes("report_mode")) {
        if (state.readError && c.cols.includes("checked_at")) return { data: null, error: state.readError };
        return { data: state.reservations, error: null };
      }
      if (c.cols === "id") return { data: state.stillReserved, error: null };
      if (c.cols?.includes("attendance_record_id")) return { data: state.linkError ? null : state.links, error: state.linkError };
      return { data: state.siblings, error: null };
    }
    if (c.table === "attendance_records" && c.op === "select") {
      if (c.cols?.includes("recorded_at")) return { data: state.day, error: null };
      if (c.cols?.includes("session_units")) return { data: state.cells, error: null };
      return { data: state.absRows, error: null };
    }
    if (c.table === "audit_logs") return { data: state.audit.filter((a) => a.metadata.reservationId === c.filters["metadata->>reservationId"]), error: null };
    if (c.table === "classes") return { data: { subject: "math", class_name: "초등M 초6 BS2P" }, error: null };
    if (c.table === "students") return { data: { name: "박지호" }, error: null };
    return { data: [{ id: "x" }], error: null };
  });
  m.admin = admin.client;
  m.session = fake(() => ({ data: [], error: null })).client;
});

const check = (outcome: "done" | "missed") => checkMakeupReservation({ studentId: STUDENT, classId: BS2P, date: DATE, outcome });
const writes = (table: string, op: "update" | "delete") => admin.calls.filter((c) => c.table === table && c.op === op);

describe("checkMakeupReservation — 보강 했음", () => {
  it("🔴 박지호 건 — 정규 수업일 정규 칸이 먼저 찍혀 있으면 '지금 값 + 보강분'으로 이행하고 확인을 남긴다", async () => {
    const res = await check("done");
    expect(res).toEqual({ ok: true, outcome: "done", units: 1.5 });
    expect(m.complete).toHaveBeenCalledWith({ tenantId: "t1" }, [expect.objectContaining({ classId: BS2P, addToCurrent: true, created: false, unitsExplicit: false })]);
    expect(m.setCell).not.toHaveBeenCalled();
    const chk = writes("makeup_reservations", "update");
    expect(chk).toHaveLength(1);
    expect(chk[0]!.values).toMatchObject({ checked_by: "u1" });
    expect(chk[0]!.filters).toMatchObject({ tenant_id: "t1", status: "done", "id:in": ["r1"] });
    expect(m.log).toHaveBeenCalledWith(expect.objectContaining({ action: "makeup_reserve_check", metadata: expect.objectContaining({ outcome: "done" }) }));
  });

  it("🔴 이미 '보강' 칸이거나 정규 수업일이 아니면 보강분을 또 얹지 않는다(이행만 — 리뷰)", async () => {
    state.day = [att({ status: "makeup" })];
    await check("done");
    expect(m.complete).toHaveBeenLastCalledWith({ tenantId: "t1" }, [expect.objectContaining({ unitsExplicit: true })]);
    expect(m.complete.mock.calls.at(-1)![1][0]).not.toHaveProperty("addToCurrent");
    state.day = [att()];
    m.regularDay = false;
    await check("done");
    expect(m.complete.mock.calls.at(-1)![1][0]).toMatchObject({ unitsExplicit: true });
  });

  it("그날 칸이 없으면 찍는다 — 정규 수업일 = 출석 · 아니면 보강(화면 출결도 맞추게 알려 준다)", async () => {
    state.day = [];
    expect(await check("done")).toEqual({ ok: true, outcome: "done", units: 1.5, marked: "present" });
    expect(m.setCell).toHaveBeenLastCalledWith(expect.objectContaining({ studentId: STUDENT, classId: BS2P, sessionDate: DATE, status: "present" }));
    m.regularDay = false;
    expect(await check("done")).toMatchObject({ ok: true, marked: "makeup" });
    expect(m.setCell).toHaveBeenLastCalledWith(expect.objectContaining({ status: "makeup" }));
    expect(m.complete).not.toHaveBeenCalled();
  });

  it("결석·공결 날이면 막는다 · 처리 뒤에도 이행이 안 됐으면 확인을 남기지 않는다 · 정규 수업일을 모르면 막는다", async () => {
    state.day = [att({ status: "absent" })];
    expect("error" in (await check("done"))).toBe(true);
    state.day = [att()];
    state.stillReserved = [{ id: "r1" }];
    expect("error" in (await check("done"))).toBe(true);
    expect(writes("makeup_reservations", "update")).toHaveLength(0);
    m.regularDay = null;
    expect("error" in (await check("done"))).toBe(true);
  });

  it("이미 이행된 예약은 확인만 남긴다", async () => {
    state.reservations = [reservation({ status: "done" })];
    expect(await check("done")).toEqual({ ok: true, outcome: "done" });
    expect(m.complete).not.toHaveBeenCalled();
    expect(writes("makeup_reservations", "update")).toHaveLength(1);
  });

  it("확인 칸(0458a)이 없으면 이행만 하고 알린다", async () => {
    state.readError = { message: "column makeup_reservations.checked_at does not exist" };
    expect(await check("done")).toEqual({ ok: true, outcome: "done", checkUnsaved: true, units: 1.5 });
    expect(writes("makeup_reservations", "update")).toHaveLength(0);
  });
});

describe("checkMakeupReservation — 보강 못 했음", () => {
  const doneOn = (units: number | null, autos: { auto: number; at: string }[] = [{ auto: 1.5, at: "2026-10-27T07:30:00Z" }]) => {
    state.reservations = autos.map((_, i) => reservation({ id: `r${i + 1}`, status: "done", slot_start: i ? "16:20:00" : "15:25:00", slot_end: i ? "17:15:00" : "16:20:00" }));
    state.links = autos.map((_, i) => ({ id: `r${i + 1}`, attendance_record_id: "a1" }));
    state.cells = [{ id: "a1", slot_start: null, status: "present", session_units: units, note: "10/21 결석분 보강" }];
    state.audit = autos.map((a, i) => ({ metadata: { reservationId: `r${i + 1}`, autoUnits: a.auto }, created_at: a.at }));
  };

  it("이행 전 예약 = 지우고 결석 칸의 그 보강일 '예정' 줄만 뺀다(다른 보강일 줄은 그대로)", async () => {
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed" });
    expect(writes("makeup_reservations", "delete")[0]!.filters).toMatchObject({ tenant_id: "t1", "id:in": ["r1"] });
    const memo = writes("attendance_records", "update");
    expect(memo).toHaveLength(1);
    expect(memo[0]!.values).toEqual({ note: "병결\n10/30 보강 예정" });
  });

  it("🔴 이행된 예약 = 이행이 적은 값(1.5) 그대로면 보강분을 빼 1로 · '결석분 보강' · '보강 완료' 줄을 뺀다", async () => {
    doneOn(1.5);
    state.absRows = [{ id: "abs", note: "병결\n10/27 보강 완료" }];
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed", units: null });
    const cellWrite = writes("attendance_records", "update").find((c) => c.filters.id === "a1");
    expect(cellWrite!.values).toEqual({ note: null, session_units: null });
    expect(writes("attendance_records", "update").find((c) => c.filters.id === "abs")!.values).toEqual({ note: "병결" });
    expect(writes("makeup_reservations", "delete")).toHaveLength(1);
  });

  it("🔴 한 칸에 예약 둘(연달아 더함 2 → 2.5) = 마지막 값에서 보강분 합을 뺀다 — 처리 순서와 무관(리뷰)", async () => {
    doneOn(2.5, [{ auto: 2.5, at: "2026-10-27T08:00:00Z" }, { auto: 2, at: "2026-10-27T07:00:00Z" }]);
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed", units: 1.5 });
  });

  it("🔴 감사로그가 누적이 아니면(새 칸에 두 예약 — 두 번째가 '정규 + 자기 보강분'으로 덮어 2, 2) 빼지 않고 알린다 — 과차감 금지(재리뷰)", async () => {
    doneOn(2, [{ auto: 2, at: "2026-10-27T07:00:00Z" }, { auto: 2, at: "2026-10-27T07:00:01Z" }]);
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed", unitsLeft: true });
    expect(writes("attendance_records", "update").some((c) => "session_units" in (c.values ?? {}))).toBe(false);
    expect(writes("makeup_reservations", "delete")).toHaveLength(1);
  });

  it("사람이 시수를 고쳐 뒀으면(2) 시수는 두고 알린다 · 자동 시수를 안 쓰는 학원은 시수를 건드리지도 알리지도 않는다", async () => {
    doneOn(2);
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed", unitsLeft: true });
    expect(writes("attendance_records", "update").some((c) => "session_units" in (c.values ?? {}))).toBe(false);
    m.autoUnits = false;
    doneOn(1.5);
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed" });
  });

  it("🔴 보강만 있던 칸(정규 수업일 아님)은 `makeup_only`로 막는다 — 화면이 '보강 빼기'로 칸째 지우고 다시 묻게 · 아무것도 쓰지 않는다", async () => {
    doneOn(1.5);
    m.regularDay = false;
    expect(await check("missed")).toEqual({ error: expect.stringMatching(/출석부에서 그 칸을 지운 뒤/), code: "makeup_only" });
    expect(writes("attendance_records", "update")).toHaveLength(0);
    expect(writes("makeup_reservations", "delete")).toHaveLength(0);
  });

  it("🔴 칸이 이미 없으면('보강 빼기'로 지웠다) 정규 수업일이 아니어도 예약만 지운다 — 막다른 길 금지(재리뷰)", async () => {
    doneOn(1.5);
    m.regularDay = false;
    state.links = [{ id: "r1", attendance_record_id: null }];
    state.day = [];
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed" });
    expect(writes("makeup_reservations", "delete")).toHaveLength(1);
    expect(writes("attendance_records", "update").some((c) => "session_units" in (c.values ?? {}))).toBe(false);
  });

  it("🔴 연결이 끊겼는데 그 반 그날 다른 시수 칸이 남았으면 — 비정규일 = `makeup_only` · 정규 수업일 = 시수는 두고 알린다(경고 없는 과지급 금지 · 재리뷰)", async () => {
    doneOn(1.5);
    state.links = [{ id: "r1", attendance_record_id: null }];
    state.day = [att({ id: "a2", slot_start: "17:00:00" })];
    m.regularDay = false;
    expect(await check("missed")).toEqual({ error: expect.any(String), code: "makeup_only" });
    expect(writes("makeup_reservations", "delete")).toHaveLength(0);
    m.regularDay = true;
    expect(await check("missed")).toEqual({ ok: true, outcome: "missed", unitsLeft: true });
    expect(writes("attendance_records", "update").some((c) => "session_units" in (c.values ?? {}))).toBe(false);
  });

  it("🔴 정규 수업일인데 칸이 '보강'이거나 빼면 0이면 막는다 — 칸을 지우라고 하지 않고 출결·시수를 고치게(정규 출석까지 사라진다 · 재리뷰)", async () => {
    doneOn(1.5);
    state.cells[0]!.status = "makeup";
    const a = await check("missed");
    expect("error" in a && !("code" in a && a.code) && a.error).toMatch(/출결·시수를 고친 뒤/);
    doneOn(0.5, [{ auto: 0.5, at: "2026-10-27T07:30:00Z" }]);
    const b = await check("missed");
    expect("error" in b && b.error).toMatch(/출결·시수를 고친 뒤/);
    expect(writes("attendance_records", "update")).toHaveLength(0);
    expect(writes("makeup_reservations", "delete")).toHaveLength(0);
  });

  it("🔴 조회가 실패하면 쓰기 전에 멈춘다 — 시수는 그대로인 채 예약만 지우지 않게(리뷰)", async () => {
    doneOn(1.5);
    state.linkError = { message: "boom" };
    expect("error" in (await check("missed"))).toBe(true);
    expect(writes("makeup_reservations", "delete")).toHaveLength(0);
    expect(writes("attendance_records", "update")).toHaveLength(0);
  });

  it("같은 결석 · 같은 보강일의 다른 예약이 남으면 '예정' 줄은 둔다", async () => {
    state.siblings = [{ id: "r9", class_id: JJ2L, absence_class_id: null, makeup_date: DATE }];
    await check("missed");
    expect(writes("attendance_records", "update")).toHaveLength(0);
  });
});

describe("checkMakeupReservation — 권한", () => {
  it("🔴 강사(scoped)는 출결 수정 기간이 지나면 못 한다 · 그날 그 반 담당이어야 한다(결석난 반 담당만으로는 시수를 못 바꾼다 — 리뷰)", async () => {
    m.level = "scoped";
    m.today = "2026-11-10";
    expect("error" in (await check("done"))).toBe(true);
    m.today = DATE;
    m.teaching = new Map([["2026-10-21", new Set([JJ2L])]]);
    expect(await check("done")).toEqual({ error: "담당 반이 아닙니다" });
    m.teaching = new Map([[DATE, new Set([BS2P])]]);
    expect(await check("done")).toMatchObject({ ok: true });
  });
  it("예약이 없으면 · 잘못된 요청이면 막는다", async () => {
    state.reservations = [];
    expect("error" in (await check("done"))).toBe(true);
    expect("error" in (await checkMakeupReservation({ studentId: STUDENT, classId: BS2P, date: DATE, outcome: "x" as "done" }))).toBe(true);
  });
});
