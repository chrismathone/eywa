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
    /** 이 표의 조회를 실패시킨다(DB 오류 주입) — 실패 문장이 한글인지 보려고. */
    failTable: null as string | null,
    updates: [] as { patch: Record<string, unknown>; ids: string[] }[],
    inserts: [] as Record<string, unknown>[],
    /** delete 한 번 = 한 항목. `ids` = `.in("id", …)`로 좁힌 대상 · null = (반·학생·날짜) 칸 전체. */
    deletes: [] as { ids: string[] | null }[],
    sinceCalls: 0,
    logs: [] as { action: string; metadata?: Record<string, unknown> }[],
    /**
     * 메모 비교 조건 쓰기(빗금 칸 입력) 흉내 — 행 id → 남은 "그 사이 메모가 바뀐" 횟수. 그 횟수만큼 그 행 쓰기를 0행으로
     * 처리하고 행 메모를 `casNewNote`로 바꾼다(담당 선생님이 사유를 저장한 상황).
     */
    casMiss: new Map<string, number>(),
    casNewNote: null as string | null,
    /** true면 어긋난 행을 메모를 바꾸는 대신 **지운다**(그 사이 반별 보기에서 기록을 지운 상황). */
    casDelete: false,
  };
  /** PostgREST 빌더 흉내 — 표마다 다른 행을 돌려주고, update는 대상 id와 함께 적어 둔다. */
  const client = {
    from(table: string) {
      state.events.push(`from:${table}`);
      const ctx: { patch?: Record<string, unknown>; ids?: string[]; write?: boolean; del?: boolean; single?: boolean } =
        {};
      const b: Record<string, unknown> = {};
      for (const m of ["select", "or", "order", "range", "lte", "gte", "limit", "not", "is"]) {
        b[m] = () => b;
      }
      b.in = (col: string, vals: string[]) => {
        if (col === "id") ctx.ids = vals;
        return b;
      };
      // `.eq("id", x)` = 한 행 대상(메모만 저장) — 어느 행을 고쳤는지 적어 둔다. 다른 열은 거르지 않는다.
      b.eq = (col: string, val: string) => {
        if (col === "id") ctx.ids = [val];
        return b;
      };
      // `.maybeSingle()` = 첫 행 하나(가짜 표는 이미 "최근 입력 먼저" 순서로 둔다).
      b.maybeSingle = () => {
        ctx.single = true;
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
        ctx.del = true;
        return b;
      };
      b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        if (ctx.patch) {
          const ids = ctx.ids ?? [];
          const missed = ids.filter((id) => (state.casMiss.get(id) ?? 0) > 0);
          for (const id of missed) {
            state.casMiss.set(id, state.casMiss.get(id)! - 1);
            const row = state.records.find((r) => r.id === id);
            if (row && state.casDelete) state.records = state.records.filter((r) => r.id !== id);
            else if (row) row.note = state.casNewNote;
          }
          const wrote = ids.filter((id) => !missed.includes(id));
          state.updates.push({ patch: ctx.patch, ids: wrote });
          // 쓴 행 id를 돌려준다(`.select("id")`) — 메모 비교 조건 쓰기가 어긋난 행을 이것으로 안다.
          return Promise.resolve({ data: wrote.map((id) => ({ id })), error: null }).then(resolve, reject);
        }
        if (ctx.del) {
          state.deletes.push({ ids: ctx.ids ?? null });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        }
        if (!ctx.write) {
          state.reads.push(table);
          state.events.push(`done:${table}`);
          if (state.failTable === table) {
            // PostgREST 오류 모양 — 메시지는 **영문 원문**이다(화면에 그대로 나가면 안 되는 값).
            return Promise.resolve({
              data: null,
              error: { message: 'column attendance_records.recorded_via does not exist' },
            }).then(resolve, reject);
          }
        }
        const data =
          table === "attendance_records"
            ? state.records
            : table === "classes"
              ? state.classes
              : table === "class_schedules"
                ? state.schedules
                : [];
        return Promise.resolve({ data: ctx.single ? (data[0] ?? null) : data, error: null, count: 0 }).then(
          resolve,
          reject,
        );
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
  getCurrentUser: vi.fn(async () => ({ id: "user-1", tenantId: "tenant-1", systemRole: "master", displayName: "박소선" })),
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
// 보강 보고서 반(앵커) 칸 지우기 게이트·대신 보강 귀속 probe(원장 2026-09-30) — 이 파일은 강사 보기 몫 판정만 본다(게이트는 따로 잠근다).
vi.mock("./makeup-anchor-cells", () => ({
  makeupAnchorDeleteBlock: vi.fn(async () => null),
  // 출석부 지우기는 발송분을 허용하는 확인 함수를 쓴다(원장 2026-11-05).
  makeupAnchorDeleteCheck: vi.fn(async () => ({ block: null, keptSent: 0, keptCells: new Set<string>() })),
  anchorCellKey: (c: { studentId: string; classId: string; date: string }) => `${c.studentId}|${c.classId}|${c.date}`,
}));
vi.mock("./taught-by-db", () => ({ taughtByColumnReady: vi.fn(async () => false) }));
/** 인계일 인덱스(감사로그 12개월) — 저장 경로는 **절대 부르면 안 된다**(반응속도 1순위). 불리면 afterEach가 잡는다. */
vi.mock("@/features/classes/server/teacher-as-of-queries", () => ({
  getHomeroomSinceIndex: vi.fn(async () => {
    h.state.sinceCalls += 1;
    return { byClassTeacher: new Map<string, string>(), since: "2025-09-11" };
  }),
}));

// 자리뿐인 칸의 거절은 2026-09-14부터 자리 사유 문장이다(종전 NOT_MINE_MESSAGE "반별 보기에서 고치세요"는 자리 기록엔 거짓 안내).
import { SCOPED_REJECT_MESSAGE } from "../ghost-transfer";
import { SCOPE_INVALID_MESSAGE, SCOPE_LOAD_FAILED_MESSAGE, SCOPE_NOT_TAUGHT_MESSAGE } from "../scoped-split";
import { setAttendanceCell, setAttendanceRange } from "./actions";
import { resolveAutoUnits } from "./auto-units";

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
  h.state.deletes.length = 0;
  h.state.logs.length = 0;
  h.state.sinceCalls = 0;
  h.state.failTable = null;
  h.state.casMiss.clear();
  h.state.casNewNote = null;
  h.state.casDelete = false;
});

// 🔴 어떤 저장도 인계일 인덱스(감사로그 12개월·반 전체·직원 이름)를 읽지 않는다 — 반응속도 1순위(2026-09-11).
afterEach(() => {
  expect(h.state.sinceCalls).toBe(0);
});

describe("setAttendanceCell — 강사 전체 보기의 그날 칸", () => {
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: h.S1, classId: h.CLASS, sessionDate: D, status: "present", quiet: true, ...over });

  // ⚠️ 2026-09-12(원장 *"jj는 개인강사 출석부에 넣음 안되지."*)부터 **상태도** 자리 JJ 행엔 안 간다 —
  //    종전 기대값("상태는 세 행 모두")은 그 지시로 바뀐 것이다. 자리 행 규칙은 아래 전용 describe가 잠근다.
  it("🔴 4 → Charlie 두 교시 2·2, 자리 JJ 행은 시수도 상태도 그대로", async () => {
    mixedDay();
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 스코프가 더하는 조회는 둘뿐(classes·class_schedules) — 쓰기는 시수 묶음마다 한 문장", async () => {
    mixedDay();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
    // 판정 조회는 기존 기록 조회와 **함께 출발**한다(B4) — 기록 조회가 끝나기 전에 둘 다 떠났다.
    const ev = h.state.events;
    expect(ev.indexOf("from:classes")).toBeLessThan(ev.indexOf("done:attendance_records"));
    expect(ev.indexOf("from:class_schedules")).toBeLessThan(ev.indexOf("done:attendance_records"));
    // {2: 17:20·18:20} 한 묶음 — 자리 JJ 행은 쓰기 대상이 아니라 문장이 늘지 않는다.
    expect(h.state.updates).toHaveLength(1);
  });

  it("🔴 반별 보기(스코프 없음)는 종전 그대로 — 1.4·1.3·1.3, 판정 조회도 없다", async () => {
    mixedDay();
    expect(await cell({ units: "4" })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1820": 1.4, "r-1720": 1.3, "r-jj": 1.3 });
    expect(readTables()).toEqual(["attendance_records"]);
  });

  it('"1"은 제 몫 두 교시의 합계 1로 저장한다', async () => {
    mixedDay();
    await cell({ units: "1", scopeTeacherId: h.CHARLIE });
    expect(unitsWritten()).toEqual({ "r-1820": 0.5, "r-1720": 0.5 });
    expect(logOf("attendance_cell")?.metadata).toMatchObject({ prevUnits: 2.7, nextUnits: 1 });
  });

  // ⚠️ 2026-09-17(원장 *"내 출석부 상에서 자유롭게 숫자 설정만 하는거야"*)부터 거절이 아니다 — 자리 행은 그대로 두고 제 행을 만든다.
  it("🔴 제 몫 행이 없는 칸(자리 JJ만) — JJ 행은 그대로, 제 교시 행을 새로 만든다(자리와 함께 도는 날)", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z")];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toMatchObject([
      { slot_start: "17:20", session_units: 2, status: "present" },
      { slot_start: "18:20", session_units: 2, status: "present" },
    ]);
    expect(logOf("attendance_cell")?.metadata).toMatchObject({ created: true, scopeTeacherId: h.CHARLIE });
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

  it("새 칸(행 없음) — 혼자 맡는 날(수학형)은 종전대로 그날 전체 한 행 · 자리와 함께 도는 날은 제 교시 행 · 스코프 강사 검증은 그대로", async () => {
    h.state.classes = [{ id: h.CLASS, teacher_id: h.HOMEROOM }];
    h.state.schedules = [slot("16:20:00", null), slot("17:15:00", null)];
    h.state.records = [];
    expect(await cell({ units: "4", scopeTeacherId: h.HOMEROOM })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([[null, 4]]);
    h.state.inserts.length = 0;
    mixedDay();
    h.state.records = [];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([
      ["17:20", 2],
      ["18:20", 2],
    ]);
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

  it.each(["late", "early_leave", "makeup", "absent"] as const)("범위 색상 %s 지정은 교시 시수를 유지하고 저장된 합계를 반환한다", async (status) => {
    mixedDay();
    h.state.records = h.state.records.map((r) => ({ ...r, status: "absent" }));
    const result = await range({ status, units: undefined, scopeTeacherId: h.CHARLIE });
    expect(unitsWritten()).toEqual({});
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
    expect(result).toMatchObject({
      ok: true, applied: 1,
      autoUnits: [{ studentId: h.S1, classId: h.CLASS, sessionDate: D, units: status === "absent" ? null : 2.7 }],
    });
  });

  it("붙여넣은 1도 본인 두 교시 합계 1로 저장한다", async () => {
    mixedDay();
    h.state.schedules.push(slot("15:20:00", h.HOMEROOM));
    h.state.records.push(rec("other", "15:20:00", 1.5, "2026-09-10T08:00:00Z"));
    expect(await range({ units: "1", scopeTeacherId: h.CHARLIE })).toMatchObject({ ok: true, applied: 1 });
    expect(unitsWritten()).toEqual({ "r-1820": 0.5, "r-1720": 0.5 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
  });

  it("범위 지우기에서도 다른 선생님 교시는 함께 지우지 않는다", async () => {
    mixedDay();
    h.state.schedules.push(slot("15:20:00", h.HOMEROOM));
    h.state.records.push(rec("other", "15:20:00", 1.5, "2026-09-10T08:00:00Z"));
    expect(await range({ status: null, scopeTeacherId: h.CHARLIE })).toMatchObject({ ok: true, applied: 1 });
    expect(h.state.deletes.flatMap((d) => d.ids ?? []).sort()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 셀 저장과 같은 규칙 — Charlie 몫 2·2, 자리 JJ 행은 손대지 않는다", async () => {
    mixedDay();
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toMatchObject({
      ok: true,
      applied: 1,
      blocked: 0,
    });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
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

  it("제 몫 행이 없는 칸(자리 JJ만) — 자리 행은 그대로, 제 행을 새로 만든다(셀 저장과 같은 규칙)", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z")];
    expect(await range({ scopeTeacherId: h.CHARLIE })).toMatchObject({ ok: true, applied: 1, blocked: 0 });
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toMatchObject([
      { student_id: h.S1, slot_start: "17:20", session_units: 2, status: "present" },
      { student_id: h.S1, slot_start: "18:20", session_units: 2, status: "present" },
    ]);
  });

  it("섞인 범위 — 제 몫 있는 칸은 고치고 제 몫 없는 칸은 새로 만든다, 판정 조회는 요청당 한 번", async () => {
    mixedDay();
    h.state.records = [...h.state.records, rec("s2-jj", "16:20:00", 1, "2026-09-10T09:30:00Z", h.S2)];
    const res = await range({ scopeTeacherId: h.CHARLIE }, [
      { studentId: h.S1, classId: h.CLASS, sessionDate: D },
      { studentId: h.S2, classId: h.CLASS, sessionDate: D },
    ]);
    expect(res).toMatchObject({ ok: true, applied: 2, blocked: 0 });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
    expect(h.state.inserts).toMatchObject([
      { student_id: h.S2, slot_start: "17:20", session_units: 2 },
      { student_id: h.S2, slot_start: "18:20", session_units: 2 },
    ]);
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

  // ⚠️ 종전엔 "지우기엔 나눌 시수가 없다"며 판정 재료를 안 읽었다 — 그래서 범위 지우기가 자리(JJ) 기록까지
  //    지웠다(원장 2026-09-12). 지금은 읽는다: 자리 행을 남기려면 어느 행이 자리인지 알아야 한다.
  it("🔴 지우기(status=null) 범위도 판정 재료를 읽는다 — 자리(JJ) 행은 남기고 제 몫만 지운다", async () => {
    mixedDay();
    await range({ status: null, scopeTeacherId: h.CHARLIE });
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]);
    expect(h.state.deletes.flatMap((d) => d.ids ?? []).sort()).toEqual(["r-1720", "r-1820"]);
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

/**
 * 🔴 원장 2026-09-12 *"jj는 개인강사 출석부에 넣음 안되지."* — 강사 보기 저장은 **자리(JJ·랩실) 행을 안 건드린다**.
 * 실측 피해: 9/10 박서연D의 JJ 행 메모("9/7(월) 결석 보강…")와 입력자가 강사 보기 저장에 덮였다 — 2026-09-11 수리는
 * 시수만 제 몫 행으로 좁혔고, 상태·메모·입력자는 여전히 그날 모든 교시에 갔다. 자리 행은 자리 출석부(JJ실)의 진실이다.
 * ⚠️ JJ실은 `seat_label`을 안 박는다(랩실만 박는다) — 자리인지는 **그 교시가 자리 슬롯인가**로 안다(화면과 같은 재료).
 * ⚠️ 다른 선생님 교시 행은 **종전대로** 상태를 함께 받고 함께 지워진다 — 원장이 짚은 건 자리뿐이다.
 */
describe("🔴 강사 보기 저장은 자리(JJ·랩실) 행을 안 건드린다(원장 2026-09-12)", () => {
  const OTHER = "77777777-7777-7777-7777-777777777777";
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: h.S1, classId: h.CLASS, sessionDate: D, status: "present", quiet: true, ...over });
  const range = (
    over: Partial<Parameters<typeof setAttendanceRange>[0]> = {},
    cells = [{ studentId: h.S1, classId: h.CLASS, sessionDate: D }],
  ) => setAttendanceRange({ cells, status: "present", units: "4", quiet: true, ...over });
  /** 이번 저장이 손댄(update·delete) 행 id — 칸 전체 삭제는 표식 하나로. */
  const touched = () =>
    new Set([
      ...h.state.updates.flatMap((u) => u.ids),
      ...h.state.deletes.flatMap((d) => d.ids ?? ["<칸 전체>"]),
    ]);
  const deletedIds = () => h.state.deletes.flatMap((d) => d.ids ?? ["<칸 전체>"]).sort();

  /** 실례 + 다른 선생님 교시(15:20 OTHER) 한 칸 — "남의 교시는 종전대로"를 가른다. */
  function withOtherTeacher() {
    mixedDay();
    h.state.schedules = [...h.state.schedules, slot("15:20:00", OTHER)];
    h.state.records = [...h.state.records, rec("r-1520", "15:20:00", 1, "2026-09-10T08:00:00Z")];
  }

  it("🔴 셀 저장 — JJ 행의 상태·메모·입력자·시수는 그대로, 제 몫 두 행만 쓴다", async () => {
    mixedDay();
    expect(await cell({ units: "4", note: "9/7(월) 결석 보강", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(touched().has("r-jj")).toBe(false);
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    // 메모·입력자도 제 몫 행에만 — 이게 실측 피해의 모양이었다.
    for (const u of h.state.updates) expect(u.patch).toMatchObject({ note: "9/7(월) 결석 보강", recorded_by: "user-1" });
  });

  it("🔴 범위 채우기 — 같은 규칙(JJ 행은 손대지 않는다)", async () => {
    mixedDay();
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toMatchObject({ ok: true, applied: 1 });
    expect(touched().has("r-jj")).toBe(false);
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 셀 지우기 — 제 몫 행만 지우고 JJ 행은 남긴다(칸 전체 삭제가 아니다)", async () => {
    mixedDay();
    expect(await cell({ status: null, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 범위 지우기 — 같은 규칙", async () => {
    mixedDay();
    expect(await range({ status: null, scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toMatchObject({
      ok: true,
      applied: 1,
    });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 메모만 저장(잠긴 칸) — 가장 최근 행이 JJ여도 메모는 제 몫 행에 단다", async () => {
    mixedDay();
    h.state.records = [
      rec("r-jj", "16:20:00", 1, "2026-09-10T12:00:00Z"),
      rec("r-1820", "18:20:00", 1, "2026-09-10T11:00:00Z"),
      rec("r-1720", "17:20:00", 1, "2026-09-10T10:00:00Z"),
    ];
    expect(await cell({ note: "사유", noteOnly: true, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toEqual([{ patch: { note: "사유" }, ids: ["r-1820"] }]);
  });

  it("메모만 저장 — 그날 행이 자리 행뿐이면 메모를 달 제 기록이 없다(자리 행에 달지 않는다)", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T12:00:00Z")];
    expect(await cell({ note: "사유", noteOnly: true, scopeTeacherId: h.CHARLIE })).toEqual({ error: "그날 출결 기록이 없어 메모만 남길 수 없습니다 — 먼저 출결을 입력하세요" });
    expect(h.state.updates).toHaveLength(0);
  });

  it("🔴 랩실 자리 시수 행(seat_label)도 같은 규칙 — 반 교시 밖 시각에 찍혀 있어도", async () => {
    mixedDay();
    h.state.records = [...h.state.records, { ...rec("r-lab", "19:40:00", 1, "2026-09-10T07:00:00Z"), seat_label: "LAB" }];
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(touched().has("r-lab")).toBe(false);
    h.state.updates.length = 0;
    await cell({ status: null, scopeTeacherId: h.CHARLIE });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  /**
   * 🔴 리뷰 2026-09-12 — 자리 보호가 "그 시각에 살아 있는 자리 슬롯"에만 걸리면 슬롯 매칭이 빠지는 순간 뚫린다
   *    (자리판 '다른 시간으로 옮기기' · 마감된 슬롯 · 교시 시각 정정). 자리 문이 굳힌 `recorded_via="seat"`가 신호다.
   */
  const movedSeatRow = () => ({
    ...rec("r-moved", "19:40:00", 1, "2026-09-10T07:30:00Z"),
    recorded_via: "seat",
  });

  it("🔴 자리 문 기록(recorded_via=seat)은 슬롯이 안 맞아도 안 건드린다 — 담임 보기에서도", async () => {
    mixedDay();
    h.state.records = [...h.state.records, movedSeatRow()];
    // 담임 보기: 19:40은 그 반 슬롯이 없어 담임 폴백 = 종전엔 **제 몫**으로 시수까지 받았다.
    await cell({ units: "4", scopeTeacherId: h.HOMEROOM });
    expect(touched().has("r-moved")).toBe(false);
  });

  it("🔴 자리 문 기록은 지우기에도 남는다 — 교시 담당 보기에선 종전에 'other'로 함께 지워졌다", async () => {
    mixedDay();
    h.state.records = [...h.state.records, movedSeatRow()];
    await cell({ status: null, scopeTeacherId: h.CHARLIE });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 범위 채우기·지우기도 같은 규칙", async () => {
    mixedDay();
    h.state.records = [...h.state.records, movedSeatRow()];
    await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(touched().has("r-moved")).toBe(false);
    h.state.updates.length = 0;
    await range({ status: null, scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  it("🔴 메모만 저장의 조회가 실패하면 **한글 문장**으로 거절한다 — DB 원문(영문)을 화면에 내보내지 않는다", async () => {
    mixedDay();
    h.state.failTable = "attendance_records";
    const res = await cell({ note: "사유", noteOnly: true, scopeTeacherId: h.CHARLIE });
    expect(res).toEqual({ error: SCOPE_LOAD_FAILED_MESSAGE });
    expect(h.state.updates).toHaveLength(0);
  });

  it("숫자 수정은 본인 교시만 갱신한다", async () => {
    withOtherTeacher();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(statusWritten()).toEqual(["r-1720", "r-1820"]);
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
  });

  it("지우기도 본인 교시만 삭제한다", async () => {
    withOtherTeacher();
    await cell({ status: null, scopeTeacherId: h.CHARLIE });
    expect(deletedIds()).toEqual(["r-1720", "r-1820"]);
  });

  it("제 몫 행이 없는 칸(자리 JJ만)의 지우기 — 지울 제 기록이 없다: 아무것도 안 지우고 성공(빈칸을 지운 것뿐)", async () => {
    mixedDay();
    h.state.records = [rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z")];
    expect(await cell({ status: null, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.deletes).toHaveLength(0);
    expect(logOf("attendance_clear")).toBeUndefined();
  });

  it("🔴 반별 보기(스코프 없음)는 종전 그대로 — JJ 행도 상태를 받고, 지우기는 칸 전체", async () => {
    mixedDay();
    await cell({ units: "4" });
    expect(statusWritten()).toEqual(["r-1720", "r-1820", "r-jj"]);
    await cell({ status: null });
    expect(h.state.deletes).toEqual([{ ids: null }]);
    expect(readTables()).toEqual(["attendance_records"]); // 판정 재료 조회 없음(셀 저장 한 번의 조회뿐)
  });

  it("🔴 감사로그 — 건너뛴 자리 행 수가 남는다(역검수) · 반별 보기엔 없다", async () => {
    mixedDay();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE });
    expect(logOf("attendance_cell")?.metadata).toMatchObject({ scopeTeacherId: h.CHARLIE, skippedSeatRows: 1 });
    await cell({ status: null, scopeTeacherId: h.CHARLIE });
    expect(logOf("attendance_clear")?.metadata).toMatchObject({ scopeTeacherId: h.CHARLIE, skippedSeatRows: 1 });
    await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(logOf("attendance_range")?.metadata).toMatchObject({ skippedSeatRows: 1 });
    await range({ status: null, scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(logOf("attendance_range_clear")?.metadata).toMatchObject({ scopeTeacherId: h.CHARLIE, skippedSeatRows: 1 });
    h.state.logs.length = 0;
    await cell({ units: "4" });
    expect(logOf("attendance_cell")?.metadata).not.toHaveProperty("skippedSeatRows");
  });
});

/**
 * 🔴 원장 2026-09-14 *"그냥 그 날의 해당 담당 출석으로 전부 이전시켜. 다른 사람이 대신 찍었어도."* + *"대신 다른 사람이
 * 출결하면 메모에 남겨."* — 강사 보기의 **빗금 칸**(제 몫 행 0 · 다른 선생님 교시 기록)에 친 값은 그 행들에 **상태만** 쓴다.
 *   ① 시수 불변 ② 자리 행 불가침(자리뿐이면 거절) ③ 행마다 `대신 입력: 이름` 한 줄(기존 메모 보존·중복 안 붙임)
 *   기본값: 빗금 칸의 지우기는 막는다.
 */
describe("🔴 빗금 칸 입력 — 다른 선생님 교시 행에 상태만 옮긴다(원장 2026-09-14)", () => {
  const OTHER = "77777777-7777-7777-7777-777777777777";
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: h.S1, classId: h.CLASS, sessionDate: D, status: "present", quiet: true, ...over });
  /** 기본 칸은 **화면이 빗금 칸으로 알고 보낸** 칸(`ghost: true`) — 격자가 실제로 싣는 모양. */
  const range = (
    over: Partial<Parameters<typeof setAttendanceRange>[0]> = {},
    cells: Parameters<typeof setAttendanceRange>[0]["cells"] = [
      { studentId: h.S1, classId: h.CLASS, sessionDate: D, ghost: true },
    ],
  ) => setAttendanceRange({ cells, status: "present", units: "4", quiet: true, ...over });
  /** 행 id → 이번 저장이 쓴 메모. */
  const noteWritten = () =>
    Object.fromEntries(
      h.state.updates.filter((u) => "note" in u.patch).flatMap((u) => u.ids.map((id) => [id, u.patch.note])),
    );

  /** Charlie 보기의 빗금 칸 — 그날 기록이 다른 선생님 교시(15:20 결석 1.5)와 자리 JJ(16:20)뿐. */
  function ghostDay(note: string | null = null) {
    mixedDay();
    h.state.schedules = [...h.state.schedules, slot("15:20:00", OTHER)];
    h.state.records = [
      { ...rec("r-1520", "15:20:00", 1.5, "2026-09-10T08:00:00Z"), status: "absent", note },
      rec("r-jj", "16:20:00", 1, "2026-09-10T07:00:00Z"),
    ];
  }

  it("🔴 셀 — 상태만 쓰고 시수는 안 쓴다(친 4는 버린다) · 자리 JJ 행은 손대지 않는다 · 응답에 옮긴 행 수", async () => {
    ghostDay();
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE, ghostTransfer: true })).toEqual({
      ok: true,
      ghostTransfer: 1,
    });
    expect(statusWritten()).toEqual(["r-1520"]);
    expect(unitsWritten()).toEqual({});
    for (const u of h.state.updates) expect(u.patch).not.toHaveProperty("session_units");
    expect(h.state.inserts).toHaveLength(0);
    expect(readTables()).toEqual(["attendance_records", "class_schedules", "classes"]); // 추가 조회 없음
  });

  it("🔴 메모 — 기존 메모(결석 사유) 끝에 '대신 입력: 이름' 한 줄", async () => {
    ghostDay("병결");
    await cell({ scopeTeacherId: h.CHARLIE, ghostTransfer: true });
    expect(noteWritten()).toEqual({ "r-1520": "병결\n대신 입력: 박소선" });
  });

  it("🔴 두 번 옮겨도 메모는 한 줄 · 사람이 친 메모가 와도 남의 교시 메모를 덮지 않는다", async () => {
    ghostDay("병결\n대신 입력: 박소선");
    await cell({ note: "덮어쓰기", scopeTeacherId: h.CHARLIE, ghostTransfer: true });
    expect(noteWritten()).toEqual({ "r-1520": "병결\n대신 입력: 박소선" });
  });

  /**
   * 🔴 적대 리뷰 2026-09-14 — 메모를 읽고 쓰는 사이 담당 선생님이 사유를 저장하면 그 사유를 덮었다. 메모 비교 조건으로 쓰고,
   *    어긋나면 지금 메모를 다시 읽어 한 번 더 붙인다. 두 번 모두 어긋나면 쓰지 않고 알린다.
   */
  it("🔴 읽고 쓰는 사이 메모가 바뀌면 덮지 않고 새 메모 끝에 붙인다", async () => {
    ghostDay("병결");
    h.state.casMiss.set("r-1520", 1);
    h.state.casNewNote = "병결(입원)";
    expect(await cell({ scopeTeacherId: h.CHARLIE, ghostTransfer: true })).toEqual({ ok: true, ghostTransfer: 1 });
    expect(noteWritten()).toEqual({ "r-1520": "병결(입원)\n대신 입력: 박소선" });
    expect(statusWritten()).toEqual(["r-1520"]);
  });

  it("두 번 모두 어긋나면 쓰지 않고 다시 입력하라고 알린다 — 남의 메모를 덮는 것보다 낫다", async () => {
    ghostDay("병결");
    h.state.casMiss.set("r-1520", 2);
    h.state.casNewNote = "병결(입원)";
    expect(await cell({ scopeTeacherId: h.CHARLIE, ghostTransfer: true })).toEqual({
      error: SCOPED_REJECT_MESSAGE.stale,
    });
    expect(statusWritten()).toEqual([]);
  });

  it("🔴 그 사이 기록이 전부 지워져 한 행도 못 옮겼으면 성공이라 말하지 않는다(stale) — 거짓 '옮겼습니다' 금지", async () => {
    ghostDay();
    h.state.casMiss.set("r-1520", 1);
    h.state.casDelete = true;
    expect(await cell({ scopeTeacherId: h.CHARLIE, ghostTransfer: true })).toEqual({
      error: SCOPED_REJECT_MESSAGE.stale,
    });
    expect(logOf("attendance_cell")).toBeUndefined(); // 쓴 행이 없으니 부분 저장 로그도 없다
  });

  it("🔴 메모만 저장 — 같은 시각 여러 행이면 **화면이 보여 준 사유 메모의 행**을 고친다(대신 입력 줄뿐인 행 아님)", async () => {
    mixedDay();
    h.state.records = [
      { ...rec("r-1820", "18:20:00", 1, "2026-09-10T11:00:00Z"), note: "대신 입력: 박소선" },
      { ...rec("r-1720", "17:20:00", 1, "2026-09-10T11:00:00Z"), note: "병결\n대신 입력: 박소선" },
      rec("r-jj", "16:20:00", 1, "2026-09-10T07:00:00Z"),
    ];
    expect(await cell({ note: "병결(확인)", noteOnly: true, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toEqual([{ patch: { note: "병결(확인)" }, ids: ["r-1720"] }]);
    h.state.updates.length = 0;
    // 반별 보기(스코프 없음)도 같은 규칙.
    expect(await cell({ note: "병결(확인)", noteOnly: true })).toEqual({ ok: true });
    expect(h.state.updates).toEqual([{ patch: { note: "병결(확인)" }, ids: ["r-1720"] }]);
  });

  it("🔴 범위 — 빗금 칸으로 알고 보낸 칸의 기록이 그 사이 사라졌으면 새 행을 만들지 않는다(stale)", async () => {
    ghostDay();
    h.state.records = [];
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toEqual({
      error: SCOPED_REJECT_MESSAGE.stale,
    });
    expect(h.state.inserts).toHaveLength(0);
  });

  // ⚠️ 2026-09-17부터 이 칸은 빈칸이다(빗금이 걷혔다) — 남의 기록은 그대로 두고 제 교시 행을 새로 만든다.
  it("🔴 표식 없는 칸에 남의 교시 기록만 있으면 — 그 기록은 그대로, 제 교시(17:20·18:20) 행을 새로 만들어 친 3을 나눈다", async () => {
    ghostDay("병결");
    expect(await cell({ units: "3", note: "보강", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.inserts).toMatchObject([
      { slot_start: "17:20", session_units: 1.5, status: "present", note: "보강" },
      { slot_start: "18:20", session_units: 1.5, status: "present", note: "보강" },
    ]);
    expect(logOf("attendance_cell")?.metadata).toMatchObject({ created: true, createdSlots: ["17:20", "18:20"] });
    expect(logOf("attendance_cell")?.metadata).not.toHaveProperty("prevStatus");
  });

  it("🔴 빗금으로 알고 보낸 칸에 제 몫 행이 생겼으면 저장하지 않는다 — 제 기록을 덮지 않게", async () => {
    mixedDay();
    expect(await cell({ scopeTeacherId: h.CHARLIE, ghostTransfer: true })).toEqual({
      error: SCOPED_REJECT_MESSAGE.stale,
    });
    expect(h.state.updates).toHaveLength(0);
  });

  it("🔴 남의 교시 기록뿐인 칸의 지우기 — 남의 기록은 지우지 않는다(지울 제 기록이 없어 조용히 성공)", async () => {
    ghostDay();
    expect(await cell({ status: null, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.deletes).toHaveLength(0);
  });

  it("🔴 감사로그 — ghostTransfer(행 수)·이전 상태가 남고, 친 시수·전후 시수는 안 싣는다", async () => {
    ghostDay();
    await cell({ units: "4", scopeTeacherId: h.CHARLIE, ghostTransfer: true });
    const m = logOf("attendance_cell")?.metadata;
    expect(m).toMatchObject({
      scopeTeacherId: h.CHARLIE,
      ghostTransfer: 1,
      skippedSeatRows: 1,
      status: "present",
      prevStatus: "absent",
    });
    expect(m).not.toHaveProperty("units");
    expect(m).not.toHaveProperty("prevUnits");
  });

  it("🔴 제 몫 행이 있는 칸은 종전 경로 — 옮기기도 메모도 없다(메모는 빗금 칸에서만)", async () => {
    mixedDay();
    h.state.schedules = [...h.state.schedules, slot("15:20:00", OTHER)];
    h.state.records = [...h.state.records, rec("r-1520", "15:20:00", 1, "2026-09-10T08:00:00Z")];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(unitsWritten()).toEqual({ "r-1820": 2, "r-1720": 2 });
    expect(noteWritten()).toEqual({});
    expect(logOf("attendance_cell")?.metadata).not.toHaveProperty("ghostTransfer");
  });

  it("🔴 반별 보기(스코프 없음)는 종전 그대로 — 전 행이 받고 메모를 안 붙인다", async () => {
    ghostDay();
    expect(await cell({ units: "4" })).toEqual({ ok: true });
    expect(statusWritten()).toEqual(["r-1520", "r-jj"]);
    expect(noteWritten()).toEqual({});
  });

  it("🔴 범위 — 같은 규칙: 상태만 · 메모 · 자리 불가침 · 옮긴 칸을 돌려준다", async () => {
    ghostDay("병결");
    const res = await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(res).toMatchObject({
      ok: true,
      applied: 1,
      blocked: 0,
      ghostCells: [{ studentId: h.S1, classId: h.CLASS, sessionDate: D }],
    });
    expect(statusWritten()).toEqual(["r-1520"]);
    expect(unitsWritten()).toEqual({});
    expect(noteWritten()).toEqual({ "r-1520": "병결\n대신 입력: 박소선" });
    expect(logOf("attendance_range")?.metadata).toMatchObject({ ghostTransfer: 1, skippedSeatRows: 1 });
  });

  it("범위 — 빗금 칸과 제 몫 칸이 섞여도 칸마다 제 규칙(시수는 제 몫 칸에만)", async () => {
    ghostDay();
    h.state.records = [...h.state.records, rec("s2-1720", "17:20:00", 1, "2026-09-10T09:00:00Z", h.S2)];
    const res = await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] }, [
      { studentId: h.S1, classId: h.CLASS, sessionDate: D, ghost: true },
      { studentId: h.S2, classId: h.CLASS, sessionDate: D },
    ]);
    expect(res).toMatchObject({ ok: true, applied: 2, blocked: 0 });
    expect((res as { ghostCells?: unknown[] }).ghostCells).toEqual([{ studentId: h.S1, classId: h.CLASS, sessionDate: D }]);
    expect(unitsWritten()).toEqual({ "s2-1720": 4 });
    expect(statusWritten()).toEqual(["r-1520", "s2-1720"]);
    expect(noteWritten()).toEqual({ "r-1520": "대신 입력: 박소선" });
  });

  it("범위 지우기 — 남의 교시 기록뿐인 칸은 아무것도 안 지운다(적용 칸으로 센다 · 막힌 칸 안내가 뜨지 않게)", async () => {
    ghostDay();
    expect(
      await range({ status: null, scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] }, [
        { studentId: h.S1, classId: h.CLASS, sessionDate: D },
      ]),
    ).toMatchObject({ ok: true, applied: 1, blocked: 0 });
    expect(h.state.deletes).toHaveLength(0);
  });

  it("🔴 범위 — 표식 없는 칸에 남의 교시 기록만 있으면 제 교시 행을 새로 만든다 · 제 몫 칸은 고친다 · 로그에 친 시수", async () => {
    ghostDay();
    h.state.records = [...h.state.records, rec("s2-1720", "17:20:00", 1, "2026-09-10T09:00:00Z", h.S2)];
    const mixed = await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] }, [
      { studentId: h.S1, classId: h.CLASS, sessionDate: D },
      { studentId: h.S2, classId: h.CLASS, sessionDate: D },
    ]);
    expect(mixed).toMatchObject({ ok: true, applied: 2, blocked: 0 });
    expect(statusWritten()).toEqual(["s2-1720"]);
    expect(h.state.inserts).toMatchObject([
      { student_id: h.S1, slot_start: "17:20", session_units: 2 },
      { student_id: h.S1, slot_start: "18:20", session_units: 2 },
    ]);
    expect(logOf("attendance_range")?.metadata).toMatchObject({ units: 4, createdSlotRows: 2 });
  });
});

/**
 * 🔴 원장 2026-09-17 *"내 출석부에서 고치는건데 남의 출석부를 건드리는건 아니지. 그냥 내 출석부 상에서 자유롭게 숫자 설정만
 *    하는거야."* · *"수학 수업보고서랑 똑같은거야 … 추가로 보강하면 2 적고 3 적고"* — 강사 출석부의 제 칸은 자유롭게 고치되,
 *    **그날 교시를 다른 선생님과 나눠 맡는 날**엔 "그날 전체" 행을 만들지 않는다(교시 없는 행은 그날 수업하는 모든 강사 몫으로 읽힌다).
 */
describe("🔴 강사 출석부의 새 칸 — 나눠 맡는 날은 제 교시 행으로(원장 2026-09-17)", () => {
  const OTHER = "77777777-7777-7777-7777-777777777777";
  const cell = (over: Partial<Parameters<typeof setAttendanceCell>[0]> = {}) =>
    setAttendanceCell({ studentId: h.S1, classId: h.CLASS, sessionDate: D, status: "present", quiet: true, ...over });
  const range = (
    over: Partial<Parameters<typeof setAttendanceRange>[0]> = {},
    cells = [{ studentId: h.S1, classId: h.CLASS, sessionDate: D }],
  ) => setAttendanceRange({ cells, status: "present", units: "3", quiet: true, ...over });
  /** 기록 없는 날 · 15:20 다른 선생님 · 16:20 JJ · 17:20·18:20 Charlie. */
  function sharedEmptyDay() {
    mixedDay();
    h.state.schedules = [...h.state.schedules, slot("15:20:00", OTHER)];
    h.state.records = [];
  }

  it("🔴 빈 칸에 3(보강 포함) — 제 교시 두 행에 1.5·1.5, 그날 전체 행은 안 만든다", async () => {
    sharedEmptyDay();
    expect(await cell({ units: "3", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([
      ["17:20", 1.5],
      ["18:20", 1.5],
    ]);
  });

  it.each(["cell", "range"])("영어 60분/40분 기준 %s 저장은 제 교시마다 1.5, 화면 합은 3", async (kind) => {
    sharedEmptyDay();
    vi.mocked(resolveAutoUnits).mockResolvedValueOnce(new Map([
      [`${h.CLASS}|${D}|17:20`, 1.5], [`${h.CLASS}|${D}|18:20`, 1.5],
    ]));
    const res = kind === "cell" ? await cell({ scopeTeacherId: h.CHARLIE })
      : await range({ units: "", scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([["17:20", 1.5], ["18:20", 1.5]]);
    expect(res).toMatchObject(kind === "cell" ? { ok: true, autoUnits: 3 }
      : { ok: true, autoUnits: [{ studentId: h.S1, classId: h.CLASS, sessionDate: D, units: 3 }] });
  });

  it("숫자 없이 상태만 — 교시마다 기본(null), 칸에 보일 합(2)을 돌려줘 격자 낙관값이 맞는다", async () => {
    sharedEmptyDay();
    expect(await cell({ scopeTeacherId: h.CHARLIE })).toEqual({ ok: true, autoUnits: 2 });
    expect(h.state.inserts.map((r) => r.session_units)).toEqual([null, null]);
  });

  it("결석 — 시수를 쓰지 않는 상태는 합을 돌려주지 않는다", async () => {
    sharedEmptyDay();
    expect(await cell({ status: "absent", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => r.status)).toEqual(["absent", "absent"]);
  });

  it("🔴 보강 예약처럼 메모와 함께 찍으면 새 교시 행 **전부**에 같은 메모 — 예약 취소의 '예약이 만든 칸' 판정이 선다", async () => {
    sharedEmptyDay();
    expect(await cell({ status: "absent", units: "", note: "10/5 보강 예정", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => r.note)).toEqual(["10/5 보강 예정", "10/5 보강 예정"]);
  });

  it("🔴 새 교시 행 둘에 같은 메모 → 메모만 저장으로 고치면 두 행이 함께 바뀐다(한 행만 고치면 옛 사유가 되살아난다)", async () => {
    sharedEmptyDay();
    h.state.records = [
      { ...rec("n-1820", "18:20:00", null, "2026-09-10T11:00:00Z"), note: "병결" },
      { ...rec("n-1720", "17:20:00", null, "2026-09-10T11:00:00Z"), note: "병결" },
    ];
    expect(await cell({ note: "감기", noteOnly: true, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toEqual([{ patch: { note: "감기" }, ids: ["n-1820", "n-1720"] }]);
    h.state.updates.length = 0;
    // 메모가 서로 다르면(교시마다 사유가 다름) 화면이 보여 준 그 행만.
    h.state.records[1]!.note = "병결(오후)";
    expect(await cell({ note: "감기", noteOnly: true, scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.updates).toEqual([{ patch: { note: "감기" }, ids: ["n-1820"] }]);
  });

  it("🔴 범위 채우기(숫자 없이) — 응답이 칸 값을 행 수(2)로 알려 격자 낙관값이 1로 굳지 않는다", async () => {
    sharedEmptyDay();
    const res = await range({ units: "", scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] });
    expect(res).toMatchObject({
      ok: true,
      applied: 1,
      autoUnits: [{ studentId: h.S1, classId: h.CLASS, sessionDate: D, units: 2 }],
    });
    expect(h.state.inserts.map((r) => r.session_units)).toEqual([null, null]);
    expect(logOf("attendance_range")?.metadata).not.toHaveProperty("autoUnits");
  });

  it("🔴 자리 JJ와 함께 도는 날(다른 선생님 없음)도 제 교시 행 — JJ 문 저장이 그날 전체 행을 덮지 않게", async () => {
    mixedDay();
    h.state.records = [{ ...rec("r-jj", "16:20:00", 1, "2026-09-10T09:00:00Z"), recorded_via: "seat" }];
    expect(await cell({ units: "4", scopeTeacherId: h.CHARLIE })).toEqual({ ok: true });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([
      ["17:20", 2],
      ["18:20", 2],
    ]);
    expect(h.state.updates).toHaveLength(0);
  });

  it("범위 채우기도 같은 규칙 — 제 교시 두 행", async () => {
    sharedEmptyDay();
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toMatchObject({ ok: true, applied: 1 });
    expect(h.state.inserts.map((r) => [r.slot_start, r.session_units])).toEqual([
      ["17:20", 1.5],
      ["18:20", 1.5],
    ]);
  });

  it("반별 보기(관리자 · 스코프 없음)는 종전 그대로 — 그날 전체 한 행", async () => {
    sharedEmptyDay();
    expect(await cell({ units: "3" })).toEqual({ ok: true });
    expect(h.state.inserts).toMatchObject([{ slot_start: null, session_units: 3 }]);
  });

  it("🔴 강사 계정이 남의 id로 보기를 바꿔 보내면 저장하지 않는다(셀·범위)", async () => {
    sharedEmptyDay();
    const perm = await import("@/lib/auth/perm-matrix");
    vi.mocked(perm.accessLevelTenant).mockResolvedValueOnce("scoped");
    expect(await cell({ units: "3", scopeTeacherId: h.CHARLIE })).toEqual({ error: SCOPE_INVALID_MESSAGE });
    vi.mocked(perm.accessLevelTenant).mockResolvedValueOnce("scoped");
    expect(await range({ scopeTeacherId: h.CHARLIE, scopeClassIds: [h.CLASS] })).toEqual({ error: SCOPE_INVALID_MESSAGE });
    expect(h.state.inserts).toHaveLength(0);
  });
});
