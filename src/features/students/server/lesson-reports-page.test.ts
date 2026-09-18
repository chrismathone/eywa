import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 원생 상세 '진도' 탭의 조회 — 10건씩 쪽 · 보고서 날짜 조회(원장 2026-09-18).
 * 쪽 계산·정렬·필터가 틀어지면 화면은 멀쩡해 보이면서 줄이 두 쪽에 서거나 사라진다 — 호출 모양을 잠근다.
 */
const calls: Array<[string, ...unknown[]]> = [];
let reportRows: unknown[] = [];
let reportCount = 0;

function chain(table: string) {
  const q: Record<string, unknown> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([`${table}.${name}`, ...args]);
      return q;
    };
  for (const m of ["select", "eq", "gte", "lte", "order", "range", "in"]) q[m] = rec(m);
  q.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      table === "lesson_reports" ? { data: reportRows, count: reportCount, error: null } : { data: [], error: null },
    ).then(resolve);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: (t: string) => chain(t) }),
}));
vi.mock("server-only", () => ({}));

import { getStudentLessonReportsPage, STUDENT_REPORTS_PAGE_SIZE } from "./queries";

beforeEach(() => {
  calls.length = 0;
  reportRows = [];
  reportCount = 0;
});

describe("진도 탭 조회 — 10건씩 쪽 · 날짜 조회", () => {
  it("한 쪽은 10건이고 2쪽은 10~19번째 행이다", async () => {
    expect(STUDENT_REPORTS_PAGE_SIZE).toBe(10);
    await getStudentLessonReportsPage("s1", { page: 2 });
    expect(calls).toContainEqual(["lesson_reports.range", 10, 19]);
  });

  it("🔴 건수는 행을 안 받고 센다(count exact) · 정렬에 id를 덧붙인다 — 같은 날 여러 건이면 쪽이 흔들린다", async () => {
    await getStudentLessonReportsPage("s1");
    const select = calls.find((c) => c[0] === "lesson_reports.select")!;
    expect(select[2]).toEqual({ count: "exact" });
    const orders = calls.filter((c) => c[0] === "lesson_reports.order").map((c) => c[1]);
    expect(orders).toEqual(["report_date", "id"]);
  });

  it("날짜 조회는 보고서 날짜 양 끝 포함 · 형식이 어긋난 값은 무시한다", async () => {
    await getStudentLessonReportsPage("s1", { from: "2026-08-01", to: "2026-08-31" });
    expect(calls).toContainEqual(["lesson_reports.gte", "report_date", "2026-08-01"]);
    expect(calls).toContainEqual(["lesson_reports.lte", "report_date", "2026-08-31"]);
    calls.length = 0;
    await getStudentLessonReportsPage("s1", { from: "8월", to: "2026-8-1" });
    expect(calls.some((c) => c[0] === "lesson_reports.gte" || c[0] === "lesson_reports.lte")).toBe(false);
  });

  it("전체 건수를 돌려준다 — 빈 쪽이어도 total은 그대로", async () => {
    reportCount = 37;
    expect(await getStudentLessonReportsPage("s1", { page: 9 })).toEqual({ rows: [], total: 37 });
  });
});
