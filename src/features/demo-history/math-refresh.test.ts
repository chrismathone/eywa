import { describe, expect, it } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import { demoMathLesson, demoMathLongGoal } from "./math-refresh";
import { learningGoalError, type LearningGoal } from "@/features/math-sheets/lib/learning-plan";

describe("데모 수학 진도", () => {
  it("실제 수학 교과 차시를 사용하고 같은 날짜는 매일 재실행해도 같은 진도다", () => {
    const september = demoMathLesson("중1", "2026-09-23");
    const october = demoMathLesson("중1", "2026-10-05");
    expect(flatLessons("중1")).toContain(september);
    expect(flatLessons("중1")).toContain(october);
    expect(flatLessons("중1").indexOf(october!)).toBeGreaterThan(flatLessons("중1").indexOf(september!));
    expect(demoMathLesson("중1", "2026-09-23")).toBe(september);
  });

  it("지원하지 않는 학년은 임의 차시를 만들지 않는다", () => {
    expect(demoMathLesson("알 수 없음", "2026-09-23")).toBeNull();
  });

  it.each(["초3", "초4", "초5", "초6", "중1", "중2", "중3"])("%s 학생의 첫 목표를 보존하고 2028년까지 네 정거장을 만든다", (grade) => {
    const startBlock = demoMathLesson(grade, "2026-04-01")!;
    const endBlock = demoMathLesson(grade, "2026-09-30")!;
    const first: LearningGoal = { studentId: "demo", studyGrade: grade, endStudyGrade: grade,
      startBlock, endBlock, startDate: "2026-04-01", endDate: "2026-09-30", textbook: "개념원리",
      track: "regular", blockCount: 24,
      milestones: [{ studyGrade: grade, endBlock, endDate: "2026-09-30", blockCount: 24 }] };
    const long = demoMathLongGoal(first);
    expect(long).not.toBeNull();
    expect(learningGoalError(long!)).toBeNull();
    expect(long!.milestones).toHaveLength(4);
    expect(long!.milestones?.[0]).toEqual(first.milestones?.[0]);
    expect(long!.milestones?.map(stop => stop.blockCount)).toEqual(
      grade === "중3" ? [24, 48, 84, 96] : [24, 48, 84, 120]);
    expect(long!.milestones?.map(stop => stop.endDate)).toEqual(grade === "중3"
      ? ["2026-09-30", "2027-03-31", "2027-12-31", "2028-03-31"]
      : ["2026-09-30", "2027-03-31", "2027-12-31", "2028-09-30"]);
    expect(long!.endDate).toBe(grade === "중3" ? "2028-03-31" : "2028-09-30");
    expect(demoMathLongGoal(long!)).toBeNull();
  });
});
