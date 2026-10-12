import { beforeEach, describe, expect, it, vi } from "vitest";
import { markFolded } from "@/lib/folded-read";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ history: new Map<string, { teacherId: string; from: string | null; to: string | null }[]>() }));
vi.mock("@/features/classes/server/teacher-as-of-queries", () => ({
  getHomeroomHistoryIndex: async () => state.history,
}));

const records: Record<string, Record<string, unknown>[]> = {
  classes: [
    { id: "jj3a", teacher_id: "current-jj3a", created_at: "2026-07-01T06:17:13Z" },
    { id: "special", teacher_id: "current-special", created_at: "2026-09-03T07:02:44Z" },
    { id: "created-late", teacher_id: "current-late", created_at: "2026-10-01T00:00:00Z" },
    { id: "created-early", teacher_id: "current-late", created_at: "2026-08-01T00:00:00Z" },
  ],
  users: [
    { id: "current-jj3a", display_name: "유형숙" },
    { id: "current-special", display_name: "이성우" },
    { id: "current-late", display_name: "나중 담당" },
  ],
  lesson_reports: [
    { id: "r1", class_id: "jj3a", report_date: "2026-09-29", teacher_name: "유형숙", makeup: false, revoked_at: null },
    { id: "r2", class_id: "jj3a", report_date: "2026-10-08", teacher_name: "다음 담당", makeup: false, revoked_at: null },
  ],
  attendance_records: [],
};

function query(table: string) {
  let rows = [...(records[table] ?? [])];
  const q = {
    select: () => q,
    in: (column: string, values: unknown[]) => {
      rows = rows.filter(row => values.includes(row[column]));
      return q;
    },
    gte: (column: string, value: string) => {
      rows = rows.filter(row => String(row[column]) >= value);
      return q;
    },
    lte: (column: string, value: string) => {
      rows = rows.filter(row => String(row[column]) <= value);
      return q;
    },
    eq: (column: string, value: unknown) => {
      rows = rows.filter(row => row[column] === value);
      return q;
    },
    is: (column: string, value: unknown) => {
      rows = rows.filter(row => row[column] === value);
      return q;
    },
    or: () => q,
    order: () => q,
    range: (from: number, to: number) => {
      rows = rows.slice(from, to + 1);
      return q;
    },
    then: (resolve: (value: { data: typeof rows; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(resolve),
  };
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: query }),
}));

import { getPastClassTeachers } from "./past-class-teachers";

beforeEach(() => {
  state.history = new Map();
});

describe("지난 수업 강사 조회 경로", () => {
  it("시작 전 보고서가 배정 강사보다 우선하며, 보고서 없는 특강은 배정 강사를 추정 표시한다", async () => {
    const teachers = await getPastClassTeachers([
      { enrollmentId: "e-jj3a", classId: "jj3a", startDate: "2026-10-07", lastDate: "2026-10-07" },
      { enrollmentId: "e-special", classId: "special", startDate: "2026-09-03", lastDate: "2026-09-19" },
      { enrollmentId: "e-late", classId: "created-late", startDate: "2026-09-03", lastDate: "2026-09-19" },
      { enrollmentId: "e-early", classId: "created-early", startDate: "2026-09-03", lastDate: "2026-09-19" },
    ]);

    expect(teachers.get("e-jj3a")).toMatchObject({
      name: "유형숙", date: "2026-09-29", source: "report", inferred: true,
    });
    expect(teachers.get("e-special")).toMatchObject({
      name: "이성우", source: "current", inferred: true,
    });
    expect(teachers.has("e-late")).toBe(false);
    expect(teachers.has("e-early")).toBe(false);
  });

  it("담당 변경 이력을 읽지 못했으면 현재 배정 강사로 과거를 메우지 않는다", async () => {
    state.history = markFolded(new Map(), "담당 변경 기록 조회 실패");
    const teachers = await getPastClassTeachers([
      { enrollmentId: "e-special", classId: "special", startDate: "2026-09-03", lastDate: "2026-09-19" },
    ]);
    expect(teachers.has("e-special")).toBe(false);
  });

  it("담당 변경 이력이 있으면 현재 배정 강사를 시작 전 기간에 소급하지 않는다", async () => {
    state.history = new Map([["special", [{ teacherId: "current-special", from: "2026-10-01", to: null }]]]);
    const teachers = await getPastClassTeachers([
      { enrollmentId: "e-special", classId: "special", startDate: "2026-09-03", lastDate: "2026-09-19" },
    ]);
    expect(teachers.has("e-special")).toBe(false);
  });
});
