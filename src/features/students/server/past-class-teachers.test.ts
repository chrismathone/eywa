import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/features/classes/server/teacher-as-of-queries", () => ({
  getHomeroomHistoryIndex: async () => new Map(),
}));

const records: Record<string, Record<string, unknown>[]> = {
  classes: [
    { id: "jj3a", teacher_id: "current-jj3a" },
    { id: "special", teacher_id: "current-special" },
  ],
  users: [],
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

describe("지난 수업 강사 조회 경로", () => {
  it("수강 시작 전 보고서라도 같은 반의 종료일 이전 최신 기록을 찾아 표시한다", async () => {
    const teachers = await getPastClassTeachers([
      { enrollmentId: "e-jj3a", classId: "jj3a", startDate: "2026-10-07", lastDate: "2026-10-07" },
      { enrollmentId: "e-special", classId: "special", startDate: "2026-09-03", lastDate: "2026-09-19" },
    ]);

    expect(teachers.get("e-jj3a")).toMatchObject({
      name: "유형숙", date: "2026-09-29", source: "report", inferred: true,
    });
    expect(teachers.has("e-special")).toBe(false);
  });
});
