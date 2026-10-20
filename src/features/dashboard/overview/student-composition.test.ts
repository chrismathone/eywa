import { describe, expect, it } from "vitest";
import { schoolsByLevel, levelSubjectSplit } from "./student-composition";
import { subjectEnrollmentSummary } from "@/features/students/enrollment/subject-enrollment-summary";
import type { Program } from "@/features/students/enrollment/program";

describe("student composition", () => {
  it("학교별 수강은 학생을 한 번씩 세고 미수강과 기타 과목을 분리한다", () => {
    const students = ["english", "both", "math", "other", "none", "both"].map((id) => ({ id, school: " 칠성초 ", grade: "초4" }));
    const programs = new Map<string, ReadonlySet<Program>>([
      ["english", new Set(["eie", "injaewon"])], ["both", new Set(["eie", "math"])], ["math", new Set(["math"])],
    ]);
    const groups = schoolsByLevel(students, programs, new Set(["english", "both", "math", "other"]));
    expect(groups[0]).toEqual({ label: "초등", total: 5, schools: [{ label: "칠성초", value: 5,
      subjects: { englishOnly: 1, both: 1, mathOnly: 1, otherOnly: 1, noEnrollment: 1 },
    }] });
  });
  it("급별로 중복 없이 영어·동시·수학·미수강을 집계하고 미입력도 남긴다", () => {
    const result = levelSubjectSplit([
      { id: "a", grade: "초3" }, { id: "a", grade: "초3" }, { id: "b", grade: "초4" },
      { id: "c", grade: "중1" }, { id: "d", grade: "고2" }, { id: "e", grade: "7세" }, { id: "f", grade: null },
    ], new Map<string, ReadonlySet<Program>>([
      ["a", new Set(["eie"] as const)], ["b", new Set(["injaewon", "math"] as const)],
      ["c", new Set(["math"] as const)], ["e", new Set(["eie"] as const)],
    ]));
    expect(result.rows[0]).toEqual({ label: "초등", englishOnly: 1, both: 1, mathOnly: 0, neither: 0, total: 2 });
    expect(result.rows.reduce((sum, row) => sum + row.total, 0)).toBe(6);
    expect(result.rows.reduce((sum, row) => sum + row.neither, 0)).toBe(2);
    expect(result.rows.map((row) => row.label)).toEqual(["초등", "중등", "고등", "미취학", "기타·미입력"]);
  });
  it("초·중·고 분류와 미입력·미취학을 모두 보존한다", () => {
    const groups = schoolsByLevel([
      { school: "칠성초", grade: "초5" },
      { school: "칠성초", grade: "초3" },
      { school: "침산중학교", grade: null },
      { school: "경북고", grade: "고1" },
      { school: null, grade: "중1" },
      { school: "유치원", grade: "7세" },
      { school: null, grade: null },
    ]);
    expect(groups.map((g) => [g.label, g.total])).toEqual([
      ["초등", 2],
      ["중등", 2],
      ["고등", 1],
      ["미취학", 1],
      ["기타·미입력", 1],
    ]);
    expect(groups[0].schools).toEqual([{ label: "칠성초", value: 2 }]);
    expect(
      groups.reduce(
        (sum, group) => sum + group.schools.reduce((n, s) => n + s.value, 0),
        0,
      ),
    ).toBe(7);
  });
  it("세 과목 동시 수강도 학생 한 명으로 세고 조합은 서로 겹치지 않는다", () => {
    const summary = subjectEnrollmentSummary(
      new Map([
        ["math", new Set(["a", "b", "c"])],
        ["english", new Set(["b", "c", "d"])],
        ["science", new Set(["c"])],
      ]),
    );
    expect(
      summary.combinations
        .filter((g) => g.subjects.length > 1)
        .reduce((sum, g) => sum + g.value, 0),
    ).toBe(2);
    expect(summary.combinations.reduce((sum, g) => sum + g.value, 0)).toBe(4);
    expect(
      summary.combinations.find((g) => g.subjects.length === 3)?.value,
    ).toBe(1);
    expect(subjectEnrollmentSummary(new Map()).combinations).toEqual([]);
  });
});
