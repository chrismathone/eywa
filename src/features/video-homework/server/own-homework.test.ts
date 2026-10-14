import { describe, expect, it, vi } from "vitest";
import type { ExtraIssue } from "./extra-issues";

const extra = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./extra-issues", () => ({ listExtraIssues: extra.list, findExtraIssue: vi.fn() }));
import { getOwnVideoHomework, listVideoHomeworkIssues } from "./own-homework";

type Report = { class_id: string | null; student_id: string; report_date: string; created_by: string | null };
/** 체인 끝(`range`)에서 보고서 줄을 돌려주는 가짜 DB — 건 조건(eq)을 적어 둔다. */
function fakeDb(reports: Report[]) {
  const eqs: [string, unknown][] = [];
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "gte", "lte", "order"]) builder[m] = () => builder;
  builder.eq = (col, value) => { eqs.push([col as string, value]); return builder; };
  builder.range = (from) => Promise.resolve({ data: from === 0 ? reports : [], error: null });
  return { db: { from: () => builder } as never, eqs };
}
const issue = (over: Partial<ExtraIssue>): ExtraIssue => ({ classId: "c", studentId: "s", date: "2026-10-02", teacherId: "lee", kept: false, ...over });

describe("영상 숙제를 낸 사람 한 벌 — 강사뷰와 관리자 강사 필터가 같은 판정(원장 2026-10-14)", () => {
  it("보고서 작성 계정 + 따로 낸 숙제의 선생님 · 같은 칸을 둘이 냈으면 둘 다 · 작성자 모름·옮겨 남긴 숙제는 누구의 것도 아니다", async () => {
    extra.list.mockResolvedValue([
      issue({ date: "2026-10-01", teacherId: "yoo" }), // 보고서는 lee가 쓴 같은 칸
      issue({ date: "2026-10-03", kept: true }),
      issue({ date: "2026-10-04", teacherId: null }),
    ]);
    const { db, eqs } = fakeDb([
      { class_id: "c", student_id: "s", report_date: "2026-10-01", created_by: "lee" },
      { class_id: "c", student_id: "s", report_date: "2026-10-05", created_by: null },
      { class_id: null, student_id: "s", report_date: "2026-10-06", created_by: "lee" },
    ]);
    const all = await listVideoHomeworkIssues(db, "t", "2026-10-01", "2026-10-14");
    expect(all).toEqual([{ classId: "c", studentId: "s", date: "2026-10-01", teacherIds: ["lee", "yoo"] }]);
    expect(eqs.some(([col]) => col === "created_by")).toBe(false);
    expect(extra.list).toHaveBeenCalledWith(db, "t", { fromDate: "2026-10-01", toDate: "2026-10-14", teacherId: undefined });
  });

  it("한 사람 조회에 빈 id가 오면 전원으로 넓히지 않고 실패한다(강사뷰가 남의 숙제까지 보지 않게)", async () => {
    extra.list.mockResolvedValue([]);
    const { db } = fakeDb([{ class_id: "c", student_id: "s", report_date: "2026-10-02", created_by: "lee" }]);
    await expect(getOwnVideoHomework(db, "t", "", "2026-10-01", "2026-10-14")).rejects.toThrow();
  });

  it("한 사람(강사뷰) = DB에서 그 작성자로 좁히고, 칸 모양은 종전 그대로", async () => {
    extra.list.mockResolvedValue([]);
    const { db, eqs } = fakeDb([{ class_id: "c", student_id: "s", report_date: "2026-10-02", created_by: "lee" }]);
    expect(await getOwnVideoHomework(db, "t", "lee", "2026-10-01", "2026-10-14")).toEqual([{ classId: "c", studentId: "s", date: "2026-10-02" }]);
    expect(eqs).toContainEqual(["created_by", "lee"]);
    expect(extra.list).toHaveBeenCalledWith(db, "t", { fromDate: "2026-10-01", toDate: "2026-10-14", teacherId: "lee" });
  });
});
