import { describe, expect, it, vi } from "vitest";
import type { ExtraIssue } from "./extra-issues";

const extra = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./extra-issues", () => ({ listExtraIssues: extra.list, findExtraIssue: vi.fn() }));
import { getOwnVideoHomework, listVideoHomeworkIssues } from "./own-homework";

type Report = { class_id: string | null; student_id: string; report_date: string; created_by: string | null; video_homework?: boolean | null };
type Mark = { class_id: string; student_id: string; homework_date: string };
/** 표마다 줄을 들고 체인에 건 조건(eq · in · gte · lte)을 실제로 거르는 가짜 DB — 보고서에 건 조건을 적어 둔다. 보고서의 표시는 기본 '있음'. */
function fakeDb(reports: Report[], marks: Mark[] = []) {
  const queries: unknown[][][] = [];
  const builderFor = (table: string) => {
    const filters: unknown[][] = [];
    if (table === "lesson_reports") queries.push(filters);
    const builder: Record<string, (...args: unknown[]) => unknown> = {};
    for (const m of ["select", "order"]) builder[m] = () => builder;
    for (const m of ["eq", "in", "gte", "lte"]) builder[m] = (...args) => { filters.push([m, ...args]); return builder; };
    const rows: Record<string, unknown>[] = (table === "lesson_reports" ? reports.map((r) => ({ video_homework: true, ...r })) : marks).map((r) => ({ tenant_id: "t", ...r }));
    const pass = (row: Record<string, unknown>) => filters.every(([op, col, value]) => {
      const cell = row[col as string];
      return op === "eq" ? cell === value : op === "in" ? (value as unknown[]).includes(cell)
        : op === "gte" ? String(cell) >= String(value) : String(cell) <= String(value);
    });
    builder.range = (from) => Promise.resolve({ data: from === 0 ? rows.filter(pass) : [], error: null });
    return builder;
  };
  return { db: { from: builderFor } as never, queries };
}
const issue = (over: Partial<ExtraIssue>): ExtraIssue => ({ classId: "c", studentId: "s", date: "2026-10-02", teacherId: "lee", kept: false, ...over });
const narrowed = (queries: unknown[][][], col: string) => queries.some((filters) => filters.some(([op, c]) => op === "eq" && c === col));

describe("영상 숙제를 낸 사람 한 벌 — 강사뷰와 관리자 강사 필터가 같은 판정(원장 2026-10-14)", () => {
  it("보고서 작성 계정 + 따로 낸 숙제의 선생님 · 같은 칸을 둘이 냈으면 둘 다 · 작성자 모름은 누구의 것도 아니다", async () => {
    extra.list.mockResolvedValue([
      issue({ date: "2026-10-01", teacherId: "yoo" }), // 보고서는 lee가 쓴 같은 칸
      issue({ date: "2026-10-04", teacherId: null }),
    ]);
    const { db, queries } = fakeDb([
      { class_id: "c", student_id: "s", report_date: "2026-10-01", created_by: "lee" },
      { class_id: "c", student_id: "s", report_date: "2026-10-05", created_by: null },
      { class_id: null, student_id: "s", report_date: "2026-10-06", created_by: "lee" },
    ]);
    const all = await listVideoHomeworkIssues(db, "t", "2026-10-01", "2026-10-14");
    expect(all).toEqual([{ classId: "c", studentId: "s", date: "2026-10-01", teacherIds: ["lee", "yoo"] }]);
    expect(narrowed(queries, "created_by")).toBe(false);
    expect(extra.list).toHaveBeenCalledWith(db, "t", { fromDate: "2026-10-01", toDate: "2026-10-14" });
  });

  it("한 사람 조회에 빈 id가 오면 전원으로 넓히지 않고 실패한다(강사뷰가 남의 숙제까지 보지 않게)", async () => {
    extra.list.mockResolvedValue([]);
    const { db } = fakeDb([{ class_id: "c", student_id: "s", report_date: "2026-10-02", created_by: "lee" }]);
    await expect(getOwnVideoHomework(db, "t", "", "2026-10-01", "2026-10-14")).rejects.toThrow();
  });

  it("한 사람(강사뷰) = 보고서는 DB에서 그 작성자로 좁히고, 남이 따로 낸 숙제는 안 선다 · 칸 모양은 종전 그대로", async () => {
    extra.list.mockResolvedValue([issue({ date: "2026-10-03", teacherId: "yoo" })]);
    const { db, queries } = fakeDb([
      { class_id: "c", student_id: "s", report_date: "2026-10-02", created_by: "lee" },
      { class_id: "c", student_id: "s", report_date: "2026-10-09", created_by: "yoo" },
    ]);
    expect(await getOwnVideoHomework(db, "t", "lee", "2026-10-01", "2026-10-14")).toEqual([{ classId: "c", studentId: "s", date: "2026-10-02" }]);
    expect(queries.every((filters) => filters.some(([op, col, value]) => op === "eq" && col === "created_by" && value === "lee"))).toBe(true);
  });
});

// 원장 2026-10-14 *"필터하면 2회, 필터 안하면 3회"* — 이준형 10/1(보고서 표시 없이 손 기록만)이 강사 필터에서만 빠졌다 → '강사 필터 + 강사뷰 둘 다'.
describe("검사 기록 칸 · 옮겨 남긴 숙제는 그날 보고서를 쓴 선생님의 칸이다 — 필터를 골라도 장부와 같은 칸이 선다", () => {
  it("표시 없는 보고서는 그날 검사 기록이나 옮겨 남긴 숙제가 있을 때만 작성자의 칸 · 표시도 기록도 없으면 칸이 아니다", async () => {
    // 10/02 kept에 적힌 선생님(park)은 그날 보고서가 없을 때의 대체 값일 수 있다 — 칸 주인은 그날 보고서를 쓴 lee.
    extra.list.mockResolvedValue([issue({ date: "2026-10-02", teacherId: "park", kept: true }), issue({ date: "2026-10-13", teacherId: "park", kept: true })]);
    const { db, queries } = fakeDb([
      { class_id: "c", student_id: "s", report_date: "2026-10-01", created_by: "lee", video_homework: null },
      { class_id: "c", student_id: "s", report_date: "2026-10-02", created_by: "lee", video_homework: null },
      { class_id: "c", student_id: "s", report_date: "2026-10-06", created_by: "lee", video_homework: false },
      { class_id: "c", student_id: "s", report_date: "2026-10-08", created_by: "lee", video_homework: null },
      { class_id: "c", student_id: "s", report_date: "2026-10-12", created_by: "lee", video_homework: true },
      { class_id: "c", student_id: "other", report_date: "2026-10-06", created_by: "lee", video_homework: null },
    ], [{ class_id: "c", student_id: "s", homework_date: "2026-10-01" }, { class_id: "c", student_id: "s", homework_date: "2026-10-06" }]);
    const all = await listVideoHomeworkIssues(db, "t", "2026-10-01", "2026-10-14");
    // 10/13 kept는 그날 보고서가 없어 누구의 칸도 아니다(누를 때 적힌 대체 값으로 주인이 바뀌지 않게).
    expect(all.map((row) => row.date).sort()).toEqual(["2026-10-01", "2026-10-02", "2026-10-06", "2026-10-12"]);
    expect(all.every((row) => row.teacherIds.join() === "lee")).toBe(true);
    // 표시 없는 보고서는 그런 칸의 학생만 골라 읽는다(지점 전체를 읽지 않는다).
    expect(queries.filter((filters) => filters.some(([op]) => op === "in")).map((filters) => filters.find(([op]) => op === "in")?.[2])).toEqual([["s"]]);
  });

  it("🔴 따로 낸 숙제가 있는 칸은 그날 보고서를 쓴 다른 선생님의 칸이 아니다(적대적 리뷰 2026-10-14)", async () => {
    // lee가 쓴 10/06 보고서엔 표시가 없고, yoo가 그 칸에 숙제를 따로 냈다. 다음 수업에서 검사 기록이 찍혔다.
    extra.list.mockResolvedValue([issue({ date: "2026-10-06", teacherId: "yoo" })]);
    const reports = [{ class_id: "c", student_id: "s", report_date: "2026-10-06", created_by: "lee", video_homework: null }];
    const marks = [{ class_id: "c", student_id: "s", homework_date: "2026-10-06" }];
    expect(await listVideoHomeworkIssues(fakeDb(reports, marks).db, "t", "2026-10-01", "2026-10-14"))
      .toEqual([{ classId: "c", studentId: "s", date: "2026-10-06", teacherIds: ["yoo"] }]);
    expect(await getOwnVideoHomework(fakeDb(reports, marks).db, "t", "lee", "2026-10-01", "2026-10-14")).toEqual([]);
    expect(await getOwnVideoHomework(fakeDb(reports, marks).db, "t", "yoo", "2026-10-01", "2026-10-14")).toEqual([{ classId: "c", studentId: "s", date: "2026-10-06" }]);
  });
});
