import { describe, expect, it } from "vitest";
import { schoolsByLevel } from "./student-composition";
import { subjectEnrollmentSummary } from "@/features/students/subject-enrollment-summary";

describe("student composition", () => {
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
    expect(summary.concurrent).toBe(2);
    expect(summary.combinations.reduce((sum, g) => sum + g.value, 0)).toBe(4);
    expect(
      summary.combinations.find((g) => g.subjects.length === 3)?.value,
    ).toBe(1);
    expect(subjectEnrollmentSummary(new Map()).concurrent).toBe(0);
  });
});
