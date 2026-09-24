import { describe, expect, it } from "vitest";
import { aggregateBy, classOrder, schoolGradeLabel, withPreviousScores, type UnifiedRecord } from "./model";

const student = {
  source: "grade" as const, sourceId: "record", studentId: "student", name: "학생",
  school: "칠성중", grade: "중2", subject: "math", rawScore: null,
  classes: [{ id: "new", name: "현재 반", teacher: "교사", days: 2 }],
  consultationDate: null, manualConsultationDate: null, editHref: "/exams",
};

function grade(date: string, score: number | null, maxScore = 100, kind: "monthly" | "school" = "monthly"): UnifiedRecord {
  return { ...student, key: date + kind, date, score, maxScore, kind };
}

describe("통합 성적 원장", () => {
  it("학교와 학년을 중복 없이 붙이고 수업 요일이 많은 반을 먼저 보인다", () => {
    expect(schoolGradeLabel("칠성중", "중2")).toBe("칠성중2");
    expect(classOrder([
      { id: "one", name: "월반", teacher: null, days: 1 },
      { id: "two", name: "화목반", teacher: null, days: 2 },
    ]).map((item) => item.id)).toEqual(["two", "one"]);
  });

  it("첫 점수와 미입력은 증감이 없고 같은 시험 종류의 직전 유효 점수와 비교한다", () => {
    const rows = withPreviousScores([
      grade("2026-07-31", 70), grade("2026-08-31", null), grade("2026-09-30", 75),
      grade("2026-09-15", 90, 100, "school"),
    ]);
    expect(rows.find((row) => row.date === "2026-07-31")?.delta).toBeNull();
    expect(rows.find((row) => row.date === "2026-08-31")?.delta).toBeNull();
    expect(rows.find((row) => row.date === "2026-09-30")?.delta).toBe(5);
    expect(rows.find((row) => row.kind === "school")?.delta).toBeNull();
  });

  it("만점이 다르면 증감을 비우고 반별 추이는 시험 당시 반으로 집계한다", () => {
    const earlier = { ...grade("2026-08-31", 8, 10), trendClasses: [{ id: "old", name: "이전 반", teacher: null, days: 1 }] };
    const later = { ...grade("2026-09-30", 15, 20), trendClasses: [{ id: "new", name: "현재 반", teacher: null, days: 2 }] };
    const rows = withPreviousScores([earlier, later]);
    expect(rows[0]?.delta).toBeNull();
    expect(aggregateBy(rows, "class").map((item) => item.key).sort()).toEqual(["new", "old"]);
  });
});
