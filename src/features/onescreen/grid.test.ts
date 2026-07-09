import { describe, it, expect } from "vitest";
import { buildGridRows, isReportEligible } from "./grid";
import type { OneScreenStudent } from "./types";

function stu(id: string, subjects: { name: string; today?: string }[]): OneScreenStudent {
  return {
    id,
    name: id,
    grade: "중1",
    tag: "중1",
    attendance: "출석",
    subjects: subjects.map((s) => ({ name: s.name, prev: "", today: s.today ?? "" })),
    tests: {
      daily: { score: null, max: 20, prevScore: null },
      check: { score: null, max: 20, prevScore: null },
    },
    attitude: null,
    homework: "",
    progressConfirmed: false,
    reportDraft: "",
    reportSent: false,
  };
}

describe("buildGridRows", () => {
  it("학생×과목으로 평탄화하고 과목 순서를 보존한다", () => {
    const rows = buildGridRows([
      stu("a", [{ name: "수학" }]),
      stu("b", [{ name: "수학" }, { name: "영어" }]),
    ]);
    expect(rows.map((r) => r.key)).toEqual(["a::수학", "b::수학", "b::영어"]);
    expect(rows[1]!.subjectIndex).toBe(0);
    expect(rows[2]!.subjectIndex).toBe(1);
  });

  it("과목 없는 학생은 행을 만들지 않는다", () => {
    expect(buildGridRows([stu("a", [])])).toHaveLength(0);
  });
});

describe("isReportEligible", () => {
  it("오늘 진도가 있으면 true, 비었으면 false", () => {
    expect(isReportEligible({ name: "수학", prev: "", today: "1-1-1 받아올림" })).toBe(true);
    expect(isReportEligible({ name: "수학", prev: "", today: "   " })).toBe(false);
    expect(isReportEligible({ name: "수학", prev: "", today: "" })).toBe(false);
  });
});
