import { vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import type { TeachingClassRow } from "@/features/classes/server/delegation";

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: { code: string; message: string } | null };
type Predicate = { kind: string; column: string; value: unknown };
type Read = { table: string; predicates: Predicate[] };
export const DATE = "2026-10-05";
export const OWN = "class-own";
export const FOREIGN = "class-foreign";
export const TEACHER = "teacher-conducting";
export const FOREIGN_NAME = "학생의 원래 수학반";
export const ownClass: TeachingClassRow = {
  id: OWN, className: "내 정규 수학반", subject: "math", isSpecial: false,
  reportOptout: false, delegated: false, ownerName: null, delegatedAwayTo: null,
};
const settings = () => ({
  ...structuredClone(DEFAULT_SETTINGS),
  makeups: { ...DEFAULT_SETTINGS.makeups, mode: "on" as "on" | "off" },
  report: { ...DEFAULT_SETTINGS.report, showLogo: false, allowTeacherTestMax: false, showCheckTest: false },
});
export const h = {
  settings: settings(), teaching: [] as TeachingClassRow[],
  tables: {} as Record<string, Row[]>, reads: [] as Read[],
  nativeReply: { data: null, error: null } as Reply, nativeThrow: false,
  viewAs: null as { id: string; displayName: string } | null,
  rpc: vi.fn<(name: string, args: unknown) => Promise<Reply>>(async (name): Promise<Reply> => {
    if (name === "makeup_list_participants") {
      if (h.nativeThrow) throw new Error("synthetic network failure");
      return h.nativeReply;
    }
    if (["onescreen_prior_reports", "onescreen_parent_read_stats"].includes(name)) return { data: [], error: null };
    throw new Error(`Unexpected RPC: ${name}`);
  }),
};

/** Apply actual query scope to populated foreign-class fixtures; widening a query exposes peers. */
function query(table: string) {
  if (!(table in h.tables)) throw new Error(`Unexpected table: ${table}`);
  const read: Read = { table, predicates: [] };
  h.reads.push(read);
  const filters: ((row: Row) => boolean)[] = [];
  let bounds: [number, number] | null = null;
  let single = false;
  const compare = (left: unknown, kind: string, right: unknown) => {
    if (kind === "is") return left == null && right === null;
    if (kind === "eq") return left === right;
    if (kind === "in") return (right as unknown[]).includes(left);
    if (left == null) return false;
    if (kind === "lt") return String(left) < String(right);
    if (kind === "lte") return String(left) <= String(right);
    if (kind === "gte") return String(left) >= String(right);
    throw new Error(`Unexpected predicate: ${kind}`);
  };
  const filter = (kind: string, column: string, value: unknown) => {
    read.predicates.push({ kind, column, value });
    filters.push(row => compare(row[column], kind, value));
    return q;
  };
  const q = {
    select: () => q,
    eq: (column: string, value: unknown) => filter("eq", column, value),
    in: (column: string, value: unknown[]) => filter("in", column, value),
    is: (column: string, value: unknown) => filter("is", column, value),
    lt: (column: string, value: unknown) => filter("lt", column, value),
    gte: (column: string, value: unknown) => filter("gte", column, value),
    or: (expression: string) => {
      filters.push(row => expression.split(",").some(part => {
        const [column, kind, ...value] = part.split(".");
        return compare(row[column], kind, value.join(".") === "null" ? null : value.join("."));
      }));
      return q;
    },
    order: () => q,
    range: (from: number, to: number) => { bounds = [from, to]; return q; },
    single: () => { single = true; return q; },
    then: (resolve: (reply: { data: Row[] | Row | null; error: null }) => unknown) => {
      let rows = h.tables[table].filter(row => filters.every(keep => keep(row)));
      if (bounds) rows = rows.slice(bounds[0], bounds[1] + 1);
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
    },
  };
  return q;
}
export const db = { from: query, rpc: h.rpc };
export const createFakeClient = async () => db;
export const getFakeAdmin = () => db;
export const getFakeUser = async () => ({ id: TEACHER, tenantId: "tenant", displayName: "맡은 선생님", systemRole: "teacher" });
export const getFakeView = async () => h.viewAs;
export const getFakeSettings = async () => h.settings;
export const getFakeTeaching = vi.fn(async () => h.teaching);

export function nativeParticipant(student = "native", overrides: Row = {}): Row {
  return { id: `participant-${student}`, student_id: student, subject_key: "math", session_date: DATE,
    class_id: FOREIGN, anchor_class_id: FOREIGN, teacher_id: TEACHER, status: "unknown",
    start_time: "17:00", end_time: "18:00", ...overrides };
}
export function setNative(rows: Row[]) {
  h.nativeReply = { data: { participants: rows, legacy_maps: [], truncated: false, total: rows.length }, error: null };
}
export function resetFixture() {
  h.settings = settings(); h.teaching = []; h.reads = []; h.nativeThrow = false; h.viewAs = null;
  h.tables = Object.fromEntries([
    "onescreen_student_order", "attendance_records", "lesson_reports", "onescreen_daily_sessions",
    "class_sheet_plan_lines", "class_sheet_student_marks", "progress_events", "share_link_views",
  ].map(table => [table, []]));
  h.tables.users = [{ id: TEACHER, report_notice_mode: "B", ui_prefs: {} }];
  h.tables.classes = [{ id: FOREIGN, tenant_id: "tenant", class_name: FOREIGN_NAME, subject: "math" }];
  h.tables.students = ["regular", "native", "peer", "cancelled", "unanchored", "legacy"].map(id => ({
    id, name: `학생 ${id}`, grade: "중1", school: "테스트중",
  }));
  h.tables.enrollments = [
    { student_id: "regular", class_id: OWN },
    ...["native", "peer", "cancelled"].map(student_id => ({ student_id, class_id: FOREIGN })),
  ].map(row => ({ ...row, start_date: "2026-01-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null }));
  h.tables.class_schedules = [OWN, FOREIGN].map(class_id => ({
    class_id, start_time: "16:00", end_time: "17:00", day_of_week: "mon",
    valid_from: "2026-01-01", valid_to: null, slot_teacher_label: null,
  }));
  setNative([]);
}
export function enableRegularClass() { h.teaching = [ownClass]; }
export function inScopes(table: string, column: string): unknown[] {
  return h.reads.filter(read => read.table === table).flatMap(read => read.predicates
    .filter(p => p.kind === "in" && p.column === column).map(p => p.value));
}
