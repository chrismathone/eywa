import { beforeEach, vi } from "vitest";

const TENANT = "99999999-9999-4999-8999-999999999999";
const STUDENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLASS = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TEACHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RES = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PART = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const ATT = "11111111-1111-4111-8111-111111111111";
const DATE = "2026-10-05";
type Row = Record<string, unknown>;

const m = vi.hoisted(() => {
  const state = {
    tables: {} as Record<string, Row[]>, updates: [] as { table: string; patch: Row }[],
    commands: [] as Row[], gaps: [] as Row[], failCommand: false, reportId: null as string | null, teacherId: "",
    projectionState: "pending", verificationOk: false, lookupDenied: false, reservationGuard: false,
    attendancePageError: false, schedulePageError: false, settingsReadError: false,
    attendanceDayNextPageError: false, enrollmentReadError: false, scheduleMinutesNextPageError: false,
    holidays: [] as { date: string; name?: string }[],
    lessonPreset: undefined as "generic" | "chinsan" | undefined,
  };
  const rowsOf = (table: string, eq: Row, inn: Record<string, unknown[]>) => (state.tables[table] ?? []).filter((row) =>
    Object.entries(eq).every(([k, v]) => row[k] === v) && Object.entries(inn).every(([k, list]) => list.includes(row[k])));
  const builder = (table: string) => {
    const eq: Row = {};
    const inn: Record<string, unknown[]> = {};
    let patch: Row | null = null;
    let orderCol: string | null = null;
    let orderAsc = true;
    let selected = "";
    const run = () => {
      const hits = rowsOf(table, eq, inn);
      if (patch && table === "makeup_reservations" && state.reservationGuard) return { data: null, error: { message: "연결된 예약은 보강관리에서 변경해 주세요" } };
      if (patch) {
        for (const row of hits) Object.assign(row, patch);
        state.updates.push({ table, patch });
      }
      if (!patch && table === "enrollments" && state.enrollmentReadError) return { data: null, error: { message: "enrollment read failed" } };
      const data = hits.map((row) => ({ ...row }));
      if (!patch && table === "class_schedules") return { data: data.slice(0, 1000), error: null };
      return { data, error: null };
    };
    const b: Record<string, unknown> = {};
    const chain = () => b;
    b.select = (cols?: string) => { selected = typeof cols === "string" ? cols : ""; return b; };
    b.lte = chain; b.or = chain; b.limit = chain;
    b.order = (column: string, opts?: { ascending?: boolean }) => {
      orderCol = column;
      orderAsc = opts?.ascending !== false;
      return b;
    };
    b.eq = (k: string, v: unknown) => { eq[k] = v; return b; };
    b.in = (k: string, v: unknown[]) => { inn[k] = v; return b; };
    b.update = (value: Row) => { patch = value; return b; };
    b.range = (from: number, to: number) => {
      if (patch) return Promise.resolve(run());
      if (state.attendancePageError && table === "attendance_records") {
        return Promise.resolve({ data: null, error: { message: "attendance page failed" } });
      }
      if (state.attendanceDayNextPageError && table === "attendance_records" && from > 0 && selected.includes("session_units")) {
        return Promise.resolve({ data: null, error: { message: "attendance day next page failed" } });
      }
      if (state.schedulePageError && table === "class_schedules") {
        return Promise.resolve({ data: null, error: { message: "schedule page failed" } });
      }
      if (state.scheduleMinutesNextPageError && table === "class_schedules" && from > 0 && selected.includes("start_time")) {
        return Promise.resolve({ data: null, error: { message: "schedule minutes next page failed" } });
      }
      const hits = rowsOf(table, eq, inn).map((row) => ({ ...row }));
      if (orderCol) {
        hits.sort((a, b) => {
          const av = String(a[orderCol!] ?? "");
          const bv = String(b[orderCol!] ?? "");
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      return Promise.resolve({ data: hits.slice(from, to + 1), error: null });
    };
    b.maybeSingle = async () => ({ data: run().data?.[0] ?? null, error: null });
    b.then = (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, bad);
    return b;
  };
  return { state, builder };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: m.builder }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getClaims: async () => ({ data: { claims: { sub: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } } }),
      getUser: async () => ({ data: { user: null } }),
    },
    rpc: async (name: string, args: Record<string, Row>) => {
      if (name === "makeup_command") {
        m.state.commands.push(args.p_payload ?? {});
        if (m.state.failCommand) return { data: null, error: { message: "rejected" } };
        return { data: {
          id: "22222222-2222-4222-8222-222222222222", revision: 1, replayed: false, effect_key: `att:${PART}`,
          action: "participation", case_id: null, session_id: null, participant_id: PART, fulfillment_id: null,
          case_ids: [], quantities: null, warnings: [], projection_state: m.state.projectionState,
          verification: { ok: m.state.verificationOk, code: m.state.verificationOk ? "matched" : "evidence_required" },
        }, error: null };
      }
      if (name === "makeup_note_effect_gap") {
        const gap = args.p_gap ?? {};
        m.state.gaps.push(gap);
        return {
          data: {
            queued: true, id: "55555555-5555-4555-8555-555555555555",
            effect_key: gap.effect_key, kind: gap.kind, state: "failed", projection_state: "pending", case_ids: [],
          },
          error: null,
        };
      }
      if (m.state.lookupDenied) return { data: null, error: { code: "42501", details: '{"code":"forbidden"}' } };
      return { data: {
        participants: [{
          id: PART, student_id: STUDENT, subject_key: "math", session_date: DATE, class_id: CLASS,
          teacher_id: m.state.teacherId, status: "unknown", report_id: m.state.reportId, anchor_class_id: CLASS, case_ids: [],
          start_time: "16:20", end_time: "17:20",
        }],
        legacy_maps: [{ id: "33333333-3333-4333-8333-333333333333", legacy_reservation_id: RES, participant_id: PART, case_id: "44444444-4444-4444-8444-444444444444", effect_key: `att:${PART}`, state: "active" }],
        truncated: false,
      }, error: null };
    },
  }),
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettingsByTenantId: async (_tenant: string, options?: { failOnReadError?: boolean }) => {
    if (options?.failOnReadError && m.state.settingsReadError) throw new Error("settings read failed");
    return {
      preset: m.state.lessonPreset,
      makeups: { mode: "on", pilotSubjects: ["math"], allowAdditional: false },
      operations: { holidays: m.state.holidays },
    };
  },
}));
vi.mock("@/features/owner/server/lesson-profile", () => ({ getLessonProfile: async () => ({ autoUnits: true }) }));
vi.mock("@/features/audit/server/log", () => ({ logAction: async () => undefined }));

import { _resetTaughtByProbeForTest } from "./taught-by-db";

function seed(over: { units?: number | null; enrolled?: boolean; reservation?: string; attendance?: string } = {}) {
  m.state.updates = []; m.state.commands = []; m.state.gaps = []; m.state.failCommand = false;
  m.state.projectionState = "pending"; m.state.verificationOk = false;
  m.state.settingsReadError = false;
  m.state.lookupDenied = false; m.state.reservationGuard = false; m.state.attendancePageError = false; m.state.schedulePageError = false;
  m.state.attendanceDayNextPageError = false; m.state.enrollmentReadError = false; m.state.scheduleMinutesNextPageError = false; m.state.holidays = [];
  m.state.lessonPreset = undefined;
  m.state.tables = {
    classes: [{ id: CLASS, tenant_id: TENANT, subject: "math", class_name: "수학A", teacher_id: TEACHER, is_active: true, closed_at: null }],
    students: [{ id: STUDENT, tenant_id: TENANT, name: "학생" }],
    enrollments: over.enrolled === false ? [] : [{ tenant_id: TENANT, class_id: CLASS, student_id: STUDENT, start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }],
    class_schedules: [{ tenant_id: TENANT, class_id: CLASS, day_of_week: "mon", start_time: "16:20:00", end_time: "17:40:00", valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null }],
    makeup_reservations: [{ id: RES, tenant_id: TENANT, student_id: STUDENT, class_id: CLASS, absence_date: "2026-09-30", makeup_date: DATE, slot_start: "16:20:00", slot_end: "17:20:00", period_label: null, note: null, status: over.reservation ?? "reserved", created_by: TEACHER }],
    attendance_records: [{ id: ATT, tenant_id: TENANT, student_id: STUDENT, class_id: CLASS, session_date: DATE, slot_start: null, status: over.attendance ?? "present", note: null, session_units: over.units === undefined ? null : over.units, recorded_at: "2026-10-05T08:00:00.000Z", taught_by: TEACHER }],
  };
}
const cell = (over: { created?: boolean; unitsExplicit?: boolean; status?: string } = {}) => ({
  studentId: STUDENT, classId: CLASS, date: DATE, status: over.status ?? "present", created: over.created ?? true, unitsExplicit: over.unitsExplicit ?? false,
});
const unitWrites = () => m.state.updates.filter((row) => row.table === "attendance_records");
const SLOT = "99999999-9999-4999-8999-999999999998";
const OLD_SLOT = "12121212-1212-4121-8121-121212121212";
const NEW_SLOT = "13131313-1313-4131-8131-131313131313";
function slot(id: string, patch: Row = {}): Row {
  return {
    id, tenant_id: TENANT, student_id: STUDENT, class_id: CLASS, session_date: DATE, slot_start: "18:00:00",
    status: "present", note: null, session_units: null, recorded_at: "2026-10-05T09:00:00.000Z", taught_by: TEACHER, ...patch,
  };
}

beforeEach(() => { _resetTaughtByProbeForTest(); m.state.teacherId = TEACHER; m.state.reportId = null; seed(); });

export { TENANT, STUDENT, CLASS, TEACHER, OTHER, PART, ATT, DATE, SLOT, OLD_SLOT, NEW_SLOT, m, seed, cell, slot, unitWrites };
