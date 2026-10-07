import { describe, expect, it } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import { planLearningGoal } from "./learning-plan";
import { learningGoalPlanKey } from "./learning-goal-comparison";

const topics = flatLessons("중1");
const goal = planLearningGoal({ studentId: "one", studyGrade: "중1", startBlock: topics[0], endBlock: topics[4], startDate: "2026-10-01", endDate: "2026-12-31", textbook: null, track: "regular" });
describe("반 공통 학습 목표 비교", () => {
  it("다른 학생·저장 시각·객체 키 순서는 같은 계획으로 비교한다", () => {
    expect(learningGoalPlanKey({ ...goal, updatedAt: "one" })).toBe(learningGoalPlanKey({ updatedAt: "two", ...goal, studentId: "two" }));
    expect(learningGoalPlanKey({ ...goal, endStudyGrade: undefined })).toBe(learningGoalPlanKey({ ...goal, endStudyGrade: goal.studyGrade }));
  });
  it.each([
    { textbook: "다른 교재" }, { startDate: "2026-11-01" }, { endDate: "2027-01-31" },
    { endBlock: topics[5] }, { track: "supplement" as const },
    { milestones: goal.milestones!.map(stop => ({ ...stop, endDate: "2027-01-31" })) },
  ])("실제 계획 차이는 구분한다: %j", patch => {
    expect(learningGoalPlanKey({ ...goal, ...patch })).not.toBe(learningGoalPlanKey(goal));
  });
});
