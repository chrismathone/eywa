import { describe, expect, it } from "vitest";
import { withPreviousScores, type UnifiedRecord } from "./model";
import { subjectSeriesOf } from "./subject-series";

const base = {
  source: "grade" as const, sourceId: "record", studentId: "student", name: "학생",
  school: "칠성중", grade: "중2", rawScore: null, classes: [],
  consultationDate: null, manualConsultationDate: null, editHref: "/exams", kind: "monthly" as const,
};
const rec = (subject: string, date: string, score: number | null): UnifiedRecord => ({ ...base, key: `${subject}${date}`, subject, date, score, maxScore: 100 });
const subjects = {
  labelOf: (k: string) => ({ math: "수학", english: "영어" })[k] ?? k,
  colorOf: (k: string) => (k === "math" ? ("blue" as const) : ("rose" as const)),
};

describe("학생 성적 과목별 선(원장 2026-10-30 — 영어·수학을 색으로 가른다)", () => {
  it("과목마다 선 하나 · 기록 많은 과목 먼저 · 과목 색 · 달마다 평균 · 점수 없는 기록은 선에서 빠진다", () => {
    const rows = withPreviousScores([
      rec("math", "2026-09-05", 80), rec("math", "2026-09-20", 100), rec("math", "2026-10-03", 70),
      rec("english", "2026-10-10", 90), rec("english", "2026-10-11", null),
    ]);
    const s = subjectSeriesOf(rows, subjects);
    expect(s.map((x) => [x.key, x.label, x.count])).toEqual([["math", "수학", 3], ["english", "영어", 2]]);
    expect(s[0]!.points).toEqual([{ month: "2026-09", average: 90 }, { month: "2026-10", average: 70 }]);
    expect(s[1]!.points).toEqual([{ month: "2026-10", average: 90 }]);
    expect(s[0]!.color).toBe("var(--color-blue)");
    expect(s[1]!.color).toBe("var(--color-rose)");
  });
  it("두 과목이 같은 색이면 뒤 과목을 다른 색으로 비켜 준다", () => {
    const rows = withPreviousScores([rec("math", "2026-10-01", 80), rec("english", "2026-10-02", 90)]);
    const s = subjectSeriesOf(rows, { ...subjects, colorOf: () => "blue" as const });
    expect(s[0]!.color).not.toBe(s[1]!.color);
  });
});
