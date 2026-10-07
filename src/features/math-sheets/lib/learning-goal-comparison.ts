import { goalMilestones, normalizeLearningGoal, type LearningGoal } from "./learning-plan";

/** Compare the saved plan, independently of its student and optimistic-lock token. */
export function learningGoalPlanKey(value: LearningGoal): string {
  const goal = normalizeLearningGoal(value);
  return JSON.stringify([
    goal.studyGrade, goal.endStudyGrade ?? goal.studyGrade, goal.startBlock, goal.endBlock,
    goal.startDate, goal.endDate, goal.textbook ?? null, goal.track ?? "regular", goal.blockCount ?? null,
    goalMilestones(goal).map(stop => [stop.studyGrade, stop.endBlock, stop.endDate, stop.blockCount]),
  ]);
}
