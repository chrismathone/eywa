/**
 * 강사 전체 보기 시수 배분(원장 제보 2026-09-11) — 서버 액션 **행동** 테스트(가짜 supabase).
 *
 * 제보: *"출석부에서 선생님이 숫자를 입력하고 닫는데, 새로고침하면 강제로 어떤 숫자로 롤백"*.
 * 실례: 중등E_중2 정규 A 9/10(목) = 16:20 자리 JJ · 17:20 Charlie · 18:20 Charlie. Charlie 보기에서 4를 치면
 * 종전엔 JJ 1.3 + 17:20 1.3 + 18:20 1.4로 저장돼 새로고침 뒤 Charlie 칸이 2.7이었다.
 *   · 스코프 저장 = 그 강사 몫 행에만 나눈다(2·2) · 남의 행(JJ)은 시수 그대로, 상태만 받는다
 *   · 몫은 **서버가 DB(반 담임·교시)로 다시 판정**한다 — 가짜 DB에 교시를 넣어 실제 판정 경로를 태운다
 *   · 반별 보기(스코프 없음)는 종전 그대로(1.4·1.3·1.3)
 *   · 스코프가 더하는 조회는 **둘뿐**(classes·class_schedules) — 담임 시작일(감사로그)은 안 읽는다(반응속도 1순위)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const CLASS = "11111111-1111-1111-1111-111111111111";
  const POOL = "33333333-3333-3333-3333-333333333333";
  const HOMEROOM = "44444444-4444-4444-4444-444444444444";
  const CHARLIE = "55555555-5555-5555-5555-555555555555";
  const STRANGER = "66666666-6666-6666-6666-666666666666";
  const S1 = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const S2 = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const state = {
    records: [] as Record<string, unknown>[],
    classes: [] as Record<string, unknown>[],
    schedules: [] as Record<string, unknown>[],
    /** 액션이 supabase로 **읽은** 표 이름(요청 1회 = 1개). 쓰기(update·insert·delete)는 안 센다. */
    reads: [] as string[],
    /** 조회가 **출발**(`from:표`)하고 **끝난**(`done:표`) 순서 — 병렬(B4)인지 가린다. */
    events: [] as string[],
    updates: [] as { patch: Record<string, unknown>; ids: string[] }[],
    inserts: [] as Record<string, unknown>[],
    sinceCalls: 0,
    logs: [] as { action: string; metadata?: Record<string, unknown> }[],
  };
  /** PostgREST 빌더 흉내 — 표마다 다른 행을 돌려주고, update는 대상 id와 함께 적어 둔다. */
  const client = {
    from(table: string) {
      state.events.push(`from:${table}`);
      const ctx: { patch?: Record<string, unknown>; ids?: string[]; write?: boolean } = {};
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "or", "order", "range", "lte", "gte", "limit", "maybeSingle", "not"]) {
        b[m] = () => b;
      }
      b.in = (col: string, vals: string[]) => {
        if (col === "id") ctx.ids = vals;
        return b;
      };
      b.update = (patch: Record<string, unknown>) => {
        ctx.patch = patch;
        return b;
      };
      b.insert = (payload: unknown) => {
        ctx.write = true;
        for (const r of Array.isArray(payload) ? payload : [payload]) state.inserts.push(r as Record<string, unknown>);
        return b;
      };
      b.delete = () => {
        ctx.write = true;
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        if (ctx.patch) {
          state.updates.push({ patch: ctx.patch, ids: ctx.ids ?? [] });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        if (!ctx.write) {
          state.reads.push(table);
          state.events.push(`done:${table}`);
        }
        const data =
          table === "attendance_records"
            ? state.records
            : table === "classes"
              ? state.classes
              : table === "class_schedules"
                ? state.schedules
                : [];
        return Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
      };
      return b;
    },
  };
  return { state, client, CLASS, POOL, HOMEROOM, CHARLIE, STRANGER, S1, S2 };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => h.client) }));
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "user-1", tenantId: "tenant-1", systemRole: "master" })),
}));
vi.mock("@/lib/auth/perm-matrix", () => ({
  canWriteTenant: vi.fn(async () => true),
  accessLevelTenant: vi.fn(async () => "full"),
}));
vi.mock("@/features/audit/server/log", () => ({
  logAction: vi.fn(async (entry: { action: string; metadata?: Record<string, unknown> }) => {
    h.state.logs.push(entry);
  }),
}));
vi.mock("./complete-notify", () => ({ notifyIfClassAttendanceComplete: vi.fn() }));
vi.mock("@/features/attendance/live/server/absent-notify", () => ({ notifyDeskOfAbsences: vi.fn() }));
vi.mock("@/features/attendance/live/server/cross-notify", () => ({ notifyUnmarkedToPresent: vi.fn() }));
vi.mock("./makeup-note-action", () => ({ noteMakeupAgainstAbsence: vi.fn() }));
vi.mock("./absence-cell", () => ({ fetchAbsenceCells: vi.fn(), pickAbsenceNoteTarget: vi.fn() }));
vi.mock("@/features/attendance/live/server/write-policy", () => ({
  assertDeskMayWrite: vi.fn(async () => ({ ok: true })),
  isMissingViaColumn: () => false,
  lookupPeriodPhase: vi.fn(async () => "before"),
  resolveWriteVia: vi.fn(async () => "teacher"),
  userTaughtClassSet: vi.fn(async () => new Set<string>()),
  withVia: (row: Record<string, unknown>, via: string) => ({ ...row, recorded_via: via }),
}));
vi.mock("./auto-units", () => ({ resolveAutoUnits: vi.fn(async () => new Map()) }));
/** 인계일 인덱스(감사로그 12개월) — 저장 경로는 **절대 부르면 안 된다**(반응속도 1순위). 불리면 afterEach가 잡는다. */
vi.mock("@/features/classes/server/teacher-as-of-queries", () => ({
  getHomeroomSinceIndex: vi.fn(async () => {
    h.state.sinceCalls += 1;
    return { byClassTeacher: new Map<string, string>(), since: "2025-09-11" };
  }),
}));

import { NOT_MINE_MESSAGE } from "../cell-display";
import { SCOPE_INVALID_MESSAGE, SCOPE_NOT_TAUGHT_MESSAGE } from "../scoped-split";
import { setAttendanceCell, setAttendanceRange } from "./actions";

const D = "2026-09-10"; // 목요일

const slot = (start: string, teacherId: string | null, label: string | null = null) => ({
  class_id: h.CLASS,
  day_of_week: "thu",
  start_time: start,
  teacher_id: teacherId,
  slot_teacher_label: label,
  valid_from: "2026-09-01",
  valid_to: null,
});
const rec = (id: string, slotStart: string | null, units: number | null, at: string, studentId = h.S1) => ({
  id,
  class_id: h.CLASS,
  student_id: studentId,
  session_date: D,
  slot_start: slotStart,
  seat_label: null,
  recorded_at: at,
  status: "present",
  note: null,
  session_units: units,
});

/** 실례 그대로 — 조회 순서(recorded_at 내림차순): 18:20이 가장 최근. */
function mixedDay() {
  h.state.classes = [{ id: h.CLASS, teacher_id: h.HOMEROOM }];
  h.state.schedules = [slot("16:20:00", null, "JJ"), slot("17:20:00", h.CHARLIE), slot("18:20:00", h.CHARLIE)];
  h.state.records = [
    rec("r-1820", "18:20:00", 1.4, "2026-09-10T11:00:00Z"),
    rec("r-1720", "17:20:00", 1.3, "2026-09-10T10:00:00Z"),
    rec("r-jj", "16:20:00", 1.3, "2026-09-10T09:00:00Z"),
  ];
}

/** 행 id → 이번 저장이 쓴 session_units(시수를 안 건드린 행은 키 없음). */
function unitsWritten(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const u of h.state.updates) if ("session_units" in u.patch) for (const id of u.ids) out[id] = u.patch.session_units;
  return out;
}
/** 상태를 받은 행 id(정렬). */
function statusWritten(): string[] {
  return [...new Set(h.state.updates.filter((u) => "status" in u.patch).flatMap((u) => u.ids))].sort();
}
const readTables = () => [...h.state.reads].sort();
const logOf = (action: string) => h.state.logs.find((l) => l.action === action);

beforeEach(() => {
  h.state.records = [];
  h.state.classes = [];
  h.state.schedules = [];
  h.state.reads.length = 0;
  h.state.events.length = 0;
  h.state.updates.length = 0;
  h.state.inserts.length = 0;
  h.state.logs.length = 0;
  h.state.sinceCalls = 0;
});

// 🔴 어떤 저장도 인계일 인덱스(감사로그 12개월·반 전체·직원 이름)를 읽지 않는다 — 반응속도 1순위(2026-09-11).
afterEach(() => {
  expect(h.state.sinceCalls).toBe(0);
});

describe("setAttendanceCell — 강사 전체 보기의 그날 칸", () => {
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: h.S1, classId: h.CLASS, sessionDate: D, status: "present", quiet: true, ...over });

  it("🔴 4 → Charlie 두 교시 2·2, 자리 JJ 행은 시수 그대로 — 상태는 종전대로 세 행 모두", async () => {
    mixedDay();
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820", "r-jj"]);
  });

  it("🔴 스코프가 더하는 조회는 둘뿐(classes·class_schedules) — 쓰기는 시수 묶음마다 한 문장", async () => {
    mixedDay();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
    // 판정 조회는 기존 기록 조회와 **함께 출발**한다(B4) — 기록 조회가 끝나기 전에 둘 다 떠났다.
    const ev = h.state.events;
    expect(ev.indexOf("from:classes")).toBeLessThan(ev.indexOf("done:attendance_records"));
    expect(ev.indexOf("from:class_schedules")).toBeLessThan(ev.indexOf("done:attendance_records"));
    // {2: 17:20·18:20} + {시수 그대로: JJ}
    expect(h.state.updates).toHaveLength(2);
  });

  it("🔴 반별 보기(스코프 없음)는 종전 그대로 — 1.4·1.3·1.3, 판정 조회도 없다", async () => {
    mixedDay();
    expect(await cell({ units: "4" })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1820": 1.4, "r-1720": 1.3, "r-jj": 1.3 });
    expect(readTables()).toEqual(["attendance_records"]);
  });

  it('"1"(교시마다 기본)도 제 몫 행에만 — JJ 시수는 안 되돌린다', async () => {
    mixedDay();
    await cell({ units: "1", scopeTeacherId: h.CHARLIE });
    expect(unitsWritten()).toEqual({ "r-1820": null, "r-1720": null });
  });

  it("🔴 제 몫 행이 없는 칸(자리 JJ만) — 격자와 같은 문장으로 거절, 아무것도 안 쓴다", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z")];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ error: NOT_MINE_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toHaveLength(0);
  });

  it("🔴 그 달에 이 반을 안 맡은 강사의 보기 — 거절(몫을 클라가 정하지 못한다)", async () => {
    mixedDay();
    expect(await cell({ units: "4", scopeTeacherId: h.STRANGER })).toEqual({ error: SCOPE_NOT_TAUGHT_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
  });

  it("형식이 아닌 스코프 id — 거절", async () => {
    mixedDay();
    expect(await cell({ units: "4", scopeTeacherId: "t-charlie" })).toEqual({ error: SCOPE_INVALID_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
  });

  it("교시 지정 저장(ECS)엔 스코프가 끼지 않는다 — 종전대로 그 교시에 친 값, 판정 조회 없음", async () => {
    mixedDay();
    expect(await cell({ units: "4", slotStart: "17:20", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1720": 4 });
    expect(readTables()).toEqual(["attendance_records"]);
    expect(logOf("attendance_cell")?.metadata).not.toHaveProperty("scopeTeacherId");
  });

  it("감사로그에 강사 보기(scopeTeacherId)가 남는다", async () => {
    mixedDay();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(logOf("attendance_cell")?.metadata).toMatchObject({ scopeTeacherId: h.CHARLIE, units: 4 });
  });

  it("담임 폴백 반(수학형)은 인계일과 무관하게 받는다 — 인계일 이전 칸의 문지기는 격자(notMine 잠금)", async () => {
    h.state.classes = [{ id: h.CLASS, teacher_id: h.HOMEROOM }];
    h.state.schedules = [slot("16:20:00", null)];
    h.state.records = [rec("r-day", null, null, "2026-09-10T09:00:00Z")];
    expect(await cell({ units: "2", scopeTeacherId: h.HOMEROOM })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-day": 2 });
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
  });

  it("새 칸(행 없음)은 종전대로 새 행 — 스코프 강사 검증은 그대로 한다", async () => {
    mixedDay();
    h.state.records = [];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => r.session_units)).toEqual([4]);
    h.state.inserts.length = 0;
    expect(await cell({ units: "4", scopeTeacherId: h.STRANGER })).toEqual({ error: SCOPE_NOT_TAUGHT_MESSAGE });
    expect(h.state.inserts).toHaveLength(0);
  });
});

describe("setAttendanceRange — 강사 전체 보기의 범위 채우기", () => {
  const range = (
    over: Partial<Parameters<typeof setAttendanceRange>[0]> = {},
    cells = [{ studentId: h.S1, classId: h.CLASS, sessionDate: D }],
  ) => setAttendanceRange({ cells, status: "present", units: "4", quiet: true, ...over });

  it("🔴 셀 저장과 같은 규칙 — Charlie 몫 2·2, JJ 시수 그대로, 상태는 세 행 모두", async () => {
    mixedDay();
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toMatchObject({
      ok: true,
      applied: 1,
      blocked: 0,
    });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820", "r-jj"]);
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
    expect(logOf("attendance_range")?.metadata).toMatchObject({ scopeTeacherId: h.CHARLIE });
  });

  it("🔴 반별 보기 범위(스코프 없음)는 종전 그대로 — 1.4·1.3·1.3", async () => {
    mixedDay();
    await range();
    expect(unitsWritten()).toEqual({ "r-1820": 1.4, "r-1720": 1.3, "r-jj": 1.3 });
    expect(readTables()).toEqual(["attendance_records"]);
    expect(logOf("attendance_range")?.metadata).not.toHaveProperty("scopeTeacherId");
  });

  it("🔴 스코프 반 목록 밖(보강 묶음처럼 스코프 없이 그린 반)의 칸은 반별 규칙", async () => {
    mixedDay();
    await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.POOL] });
    expect(unitsWritten()).toEqual({ "r-1820": 1.4, "r-1720": 1.3, "r-jj": 1.3 });
    expect(readTables()).toEqual(["attendance_records"]);
  });

  it("제 몫 행이 없는 칸만 있으면 거절 — 아무것도 안 쓴다", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z")];
    expect(await range({ scopeTeacherId: h.CHARLIE })).toEqual({ error: NOT_MINE_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
  });

  it("섞인 범위 — 제 몫 없는 칸만 건너뛰고(blocked) 나머지는 저장, 판정 조회는 요청당 한 번", async () => {
    mixedDay();
    h.state.records = [...h.state.records, rec("s2-jj", "16:20:00", 1, "2026-09-10T09:30:00Z", h.S2)];
    const res = await range({ scopeTeacherId: h.CHARLIE }, [
      { studentId: h.S1, classId: h.CLASS, sessionDate: D },
      { studentId: h.S2, classId: h.CLASS, sessionDate: D },
    ]);
    expect(res).toMatchObject({ ok: true, applied: 1, blocked: 1 });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820", "r-jj"]);
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
  });

  it("그 달에 이 반을 안 맡은 강사 — 거절", async () => {
    mixedDay();
    expect(await range({ scopeTeacherId: h.STRANGER })).toEqual({ error: SCOPE_NOT_TAUGHT_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
  });

  it("형식이 아닌 스코프 id — 거절", async () => {
    mixedDay();
    expect(await range({ scopeTeacherId: "nope" })).toEqual({ error: SCOPE_INVALID_MESSAGE });
  });

  it("🔴 판정 재료 조회는 기존 기록 조회와 함께 출발한다(B4 — 직렬 왕복 없음)", async () => {
    mixedDay();
    await range({ scopeTeacherId: h.CHARLIE });
    const ev = h.state.events;
    expect(ev.indexOf("from:classes")).toBeGreaterThan(-1);
    expect(ev.indexOf("from:classes")).toBeLessThan(ev.indexOf("done:attendance_records"));
    expect(ev.indexOf("from:class_schedules")).toBeLessThan(ev.indexOf("done:attendance_records"));
  });

  it("지우기(status=null) 범위엔 판정 재료를 읽지 않는다 — 나눌 시수가 없다", async () => {
    mixedDay();
    await range({ status: null, scopeTeacherId: h.CHARLIE });
    expect(readTables()).toEqual(["attendance_records"]);
  });

  it("형식이 아닌 scopeClassIds(배열 아님·uuid 아님) — 던지지 않고 거절", async () => {
    mixedDay();
    for (const bad of ["abc", ["not-a-uuid"], new Set([h.CLASS]), [h.CLASS, 3]]) {
      expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: bad as never }), String(bad)).toEqual({
        error: SCOPE_INVALID_MESSAGE,
      });
    }
    expect(h.state.updates).toHaveLength(0);
  });

  it("빈 scopeClassIds([])는 '스코프 반 없음' — 반별 규칙 그대로", async () => {
    mixedDay();
    await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [] });
    expect(unitsWritten()).toEqual({ "r-1820": 1.4, "r-1720": 1.3, "r-jj": 1.3 });
  });
});
