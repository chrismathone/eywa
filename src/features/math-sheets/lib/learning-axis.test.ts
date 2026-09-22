import { describe, expect, it } from "vitest";
import { LEARNING_LESSON_WIDTH, learningCurrentPosition, learningGoalTicks, learningTopicTicks } from "./learning-axis";
import { buildLearningProgress, planLearningGoal } from "./learning-plan";
import { topicSegments } from "./learning-path";
import { flatLessons } from "@/features/onescreen/curriculum";

const context = { schedules: [], holidays: {}, spans: {} };
const goal = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: "다각형", endStudyGrade: "중3", endBlock: "이차함수의 최댓값과 최솟값", startDate: "2026-09-01", endDate: "2027-08-31", textbook: null });
const base = buildLearningProgress(goal, context, [], "2026-09-18");
const state = { ...base, currentBlock: "수학 다각형", current: 2 };
const semesterLabels = (ticks: ReturnType<typeof learningTopicTicks>) => topicSegments(ticks).map(topics => `${topics[0].grade}-${topics[0].semester}`);

describe("차시마다 동일한 간격의 최대 6학기 진도선", () => {
  it("현재 진도 이전 2학기와 현재부터 4학기만 표시한다", () => {
    const ticks = learningTopicTicks(goal, state);
    expect(semesterLabels(ticks)).toEqual(["초6-2", "중1-1", "중1-2", "중2-1", "중2-2", "중3-1"]);
    expect(learningGoalTicks(goal, ticks)).toHaveLength(6);
    expect(ticks.map(tick => tick.position)).toEqual(ticks.map((_, index) => index + 1));
    expect(LEARNING_LESSON_WIDTH).toBeGreaterThanOrEqual(6);
    for (const topic of ticks) {
      expect(learningCurrentPosition(goal, { ...state, currentBlock: `${topic.grade} · ${topic.lesson}` }, ticks)).toBe(topic.position);
    }
  });
  it("현재 진도가 다음 학기로 넘어가면 표시 범위도 한 학기 이동한다", () => {
    const next = { ...state, currentBlock: "중2 · 유리수와 소수" };
    const ticks = learningTopicTicks(goal, next);
    expect(semesterLabels(ticks)).toEqual(["중1-1", "중1-2", "중2-1", "중2-2", "중3-1", "중3-2"]);
    expect(learningCurrentPosition(goal, next, ticks)).toBe(ticks.find(tick => tick.lesson === "유리수와 소수")?.position);
  });
  it("학기 목표는 실제 차시 끝에 놓이고 구간을 같은 폭으로 나누지 않는다", () => {
    const ticks = learningTopicTicks(goal, state);
    const stops = learningGoalTicks(goal, ticks);
    let cumulative = 0;
    for (const [index, semester] of topicSegments(ticks).entries()) {
      cumulative += semester.length;
      expect(stops[index].position).toBe(cumulative);
    }
    expect(stops[0].position).not.toBe(ticks.length / 6);
    expect(stops.at(-1)?.endDate).toBe(goal.endDate);
    expect(stops[0].endDate).toBeNull();
    expect(stops[0].blockCount).toBeNull();
  });
  it("같은 6학기라도 차시 수에 따라 전체 길이가 다르다", () => {
    const a = learningTopicTicks(goal, state);
    const b = learningTopicTicks(goal, { ...state, currentBlock: "중2 · 유리수와 소수" });
    expect(learningGoalTicks(goal, a)).toHaveLength(6);
    expect(learningGoalTicks(goal, b)).toHaveLength(6);
    expect(a.length * LEARNING_LESSON_WIDTH).not.toBe(b.length * LEARNING_LESSON_WIDTH);
  });
  it("처음 학년과 선택과목의 끝에서는 없는 학기를 만들지 않는다", () => {
    const early = planLearningGoal({ ...goal, studyGrade: "초1", endStudyGrade: "초1", startBlock: flatLessons("초1")[0], endBlock: flatLessons("초1").at(-1)! });
    expect(semesterLabels(learningTopicTicks(early))).toEqual(["초1-1", "초1-2", "초2-1", "초2-2"]);
    const last = planLearningGoal({ ...goal, studyGrade: "기하", endStudyGrade: "기하", startBlock: flatLessons("기하")[0], endBlock: flatLessons("기하").at(-1)! });
    const ticks = learningTopicTicks(last);
    expect(learningGoalTicks(last, ticks).length).toBeLessThanOrEqual(6);
    expect(ticks.at(-1)?.grade).toBe("기하");
    expect(ticks.some(tick => tick.grade === "대수")).toBe(false);
  });
  it("목표를 확장해도 현재 진도가 같으면 표시 구간과 간격은 유지한다", () => {
    const extended = planLearningGoal({ ...goal, endStudyGrade: "공통수학2", endBlock: flatLessons("공통수학2").at(-1)! }, goal);
    expect(learningTopicTicks(extended, state)).toEqual(learningTopicTicks(goal, state));
    expect(learningGoalTicks(extended, learningTopicTicks(extended, state))).toHaveLength(6);
  });
  it("보강이나 옛 목표도 차시 간격이 동일하며 횟수로 위치를 추정하지 않는다", () => {
    for (const variant of [{ ...goal, track: "supplement" as const }, { ...goal, blockCount: null, milestones: [] }]) {
      expect(learningTopicTicks(variant, state)).toEqual(learningTopicTicks(goal, state));
      expect(learningCurrentPosition(variant, { ...state, current: 2, currentBlock: "내신대비" })).toBeNull();
    }
  });
});
