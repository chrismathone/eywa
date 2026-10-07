import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ tables: {} as Record<string, Record<string, unknown>[]>, delegated: [] as string[] }));
vi.mock("@/lib/date-kst", () => ({ kstToday: () => "2026-10-07" }));
vi.mock("@/features/classes/server/delegation", () => ({ getDelegatedClassIdsInRange: async () => m.delegated }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let rows = m.tables[table] ?? [];
  const q = {
    select: () => q, order: () => q,
    eq: (key: string, value: unknown) => { rows = rows.filter((r) => r[key] === value); return q; },
    in: (key: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[key])); return q; },
    lte: (key: string, value: string) => { rows = rows.filter((r) => String(r[key]) <= value); return q; },
    or: () => { rows = rows.filter((r) => !r.end_date || String(r.end_date) >= "2026-10-07"); return q; },
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  }; return q;
} }) }));
import { getTeacherReadScope, liveTeachingClassIds } from "./teacher-read-scope";
beforeEach(() => {
  m.delegated = [];
  m.tables = {
    classes: [{ id: "slot", teacher_id: "homeroom", subject: "english" }, { id: "other", teacher_id: "other", subject: "math" }],
    class_schedules: [{ class_id: "slot", teacher_id: "teacher", day_of_week: "fri", valid_from: "2026-01-01", valid_to: null }],
    enrollments: [{ student_id: "active", class_id: "slot", start_date: "2026-01-01", end_date: null },
      { student_id: "future", class_id: "slot", start_date: "2026-11-01", end_date: null },
      { student_id: "ended", class_id: "slot", start_date: "2026-01-01", end_date: "2026-09-01" },
      { student_id: "unrelated", class_id: "other", start_date: "2026-01-01", end_date: null }],
  };
});
it("includes a teacher with only one weekly period, with active students and the right subject", async () => {
  expect(await getTeacherReadScope("teacher")).toEqual({ classIds: ["slot"], studentIds: ["active"], subjects: ["english"] });
});
it("does not use someone else's periods or display labels as assignment", async () => {
  expect(await getTeacherReadScope("unassigned")).toEqual({ classIds: [], studentIds: [], subjects: [] });
});
it("checks the actual weekday against valid dates, including an inclusive end date", () => {
  const slot = { class_id: "c", day_of_week: "fri", valid_from: "2026-10-09", valid_to: "2026-10-09" };
  expect(liveTeachingClassIds([slot, slot], "2026-10-05")).toEqual(["c"]);
  expect(liveTeachingClassIds([{ ...slot, valid_to: "2026-10-08" }], "2026-10-05")).toEqual([]);
  expect(liveTeachingClassIds([{ ...slot, valid_from: "2026-10-10" }], "2026-10-05")).toEqual([]);
});
