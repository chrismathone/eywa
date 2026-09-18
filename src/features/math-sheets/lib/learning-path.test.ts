import { describe, expect, it } from "vitest";
import { flatLessons, curriculumForGradeSemester } from "@/features/onescreen/curriculum";
import { learningCoursePath, learningTopics, learningTopicIndex } from "./learning-path";
import { buildLearningProgress, goalMilestones, learningBlocks, learningDays, learningGoalError, planLearningGoal, type LearningContext, type LearningGoal } from "./learning-plan";

const semester = curriculumForGradeSemester("중1", 1).flatMap((unit) => unit.lessons);
const first: LearningGoal = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: semester[0], endBlock: semester.at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
const context: LearningContext = { schedules: ["mon", "wed"].map((dayOfWeek) => ({ dayOfWeek, startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null })), holidays: {}, spans: { s: [{ start: "2026-01-01", end: null }] } };

describe("여러 과정을 잇는 최종 목표와 정거장", () => {
  it("복습 심화 확장도 앞 목표의 4블록 배분과 도착 단원을 보존한다", () => {
    const review = planLearningGoal({ ...first, track: "supplement" });
    const second = planLearningGoal({ ...review, endStudyGrade: "중2", endBlock: flatLessons("중2").at(-1)! }, review);
    const third = planLearningGoal({ ...second, endStudyGrade: "중3", endBlock: flatLessons("중3").at(-1)! }, second);
    expect(learningGoalError(third)).toBeNull();
    expect(learningBlocks(third).slice(0, 4).map(label => label.replaceAll("중1 · ", ""))).toEqual(learningBlocks(review));
    for (const stop of goalMilestones(third)) expect(learningBlocks(third)[stop.blockCount - 1]).toContain(stop.endBlock);
  });
  it("중1에서 대수까지 필요한 과정을 포함하고 다른 선택과목은 끼우지 않는다", () => {
    const goal = planLearningGoal({ ...first, endStudyGrade: "대수", endBlock: flatLessons("대수").at(-1)! });
    expect(learningCoursePath("중1", "대수")).toEqual(["중1", "중2", "중3", "공통수학1", "공통수학2", "대수"]);
    expect(learningGoalError(goal)).toBeNull();
    expect(learningBlocks(goal)).toHaveLength(108);
    expect(goal.endDate).toBe("2028-11-30");
    expect(learningBlocks(goal).at(-1)).toContain("대수");
    expect(learningDays(goal, context).at(-1)?.target).toBe(108);
    const progress = buildLearningProgress(goal, context, [{ date: "2026-09-16", progress: `수학 ${flatLessons("중2")[0]}`, textbook: null }], "2026-09-18");
    expect(progress.current).toBeGreaterThan(24);
    expect(progress.current).toBeLessThan(36);
    expect(progress.currentBlock).toContain("중2");
  });
  it("2차·3차 확장 시 이전 도착점·날짜·배분과 현재 진도가 그대로 유지된다", () => {
    const second = planLearningGoal({ ...first, endStudyGrade: "중2", endBlock: flatLessons("중2").at(-1)! }, first);
    const third = planLearningGoal({ ...second, endStudyGrade: "대수", endBlock: flatLessons("대수").at(-1)! }, second);
    expect(learningGoalError(second)).toBeNull();
    expect(learningGoalError(third)).toBeNull();
    expect(goalMilestones(third).slice(0, 2)).toEqual(goalMilestones(second));
    expect(goalMilestones(second)[0]).toEqual(goalMilestones(first)[0]);
    expect(goalMilestones(third)).toHaveLength(3);
    expect(learningBlocks(third).slice(0, 12).map((label) => label.replaceAll("중1 · ", ""))).toEqual(learningBlocks(first));
    const records = [{ date: "2026-09-16", progress: semester[10], textbook: null }];
    expect(buildLearningProgress(third, context, records, "2026-09-18").current).toBe(buildLearningProgress(first, context, records, "2026-09-18").current);
    expect(learningDays(third, context).filter((day) => day.date <= first.endDate).map((day) => day.target)).toEqual(learningDays(first, context).map((day) => day.target));
  });
  it("도착점을 중복하거나 뒤로 돌리는 확장을 거절한다", () => {
    expect(learningGoalError(planLearningGoal(first, first))).not.toBeNull();
    expect(learningGoalError(planLearningGoal({ ...first, endStudyGrade: "초6", endBlock: flatLessons("초6").at(-1)! }, first))).not.toBeNull();
    expect(learningGoalError({ ...first, milestones: [{ ...goalMilestones(first)[0], endDate: "2026-10-31" }] })).not.toBeNull();
  });
  it("선택과목 경로는 분기하며 고등의 동명 차시를 임의로 나중 과목에 매칭하지 않는다", () => {
    expect(learningCoursePath("중3", "기하")).toEqual(["중3", "공통수학1", "공통수학2", "기하"]);
    expect(learningCoursePath("미적분Ⅱ", "대수")).toEqual([]);
    const topics = learningTopics({ studyGrade: "미적분Ⅰ", endStudyGrade: "미적분Ⅱ", startBlock: flatLessons("미적분Ⅰ")[0], endBlock: flatLessons("미적분Ⅱ").at(-1)! });
    const duplicates = topics.filter((topic, index) => topics.findIndex((other) => other.lesson === topic.lesson) !== index);
    expect(duplicates.length).toBeGreaterThan(0);
    const duplicate = duplicates[0];
    expect(learningTopicIndex(duplicate.lesson, topics)).toBeNull();
    const index = learningTopicIndex(`수학 ${duplicate.grade} ${duplicate.lesson}`, topics);
    expect(index).not.toBeNull();
    expect(topics[index!].grade).toBe(duplicate.grade);
  });
  it("최종 대수 단원을 기록하면 여러 과정 전체가 100%가 된다", () => {
    const goal = planLearningGoal({ ...first, endStudyGrade: "대수", endBlock: flatLessons("대수").at(-1)! });
    const progress = buildLearningProgress(goal, context, [{ date: "2026-09-16", progress: goal.endBlock, textbook: null }], "2026-09-18");
    expect(progress.percent).toBe(100);
    expect(progress.status).toBe("done");
  });
  it("선택과목 사이에서 확장해도 이전에 거친 과목이 경로에서 사라지지 않는다", () => {
    const geometry = planLearningGoal({ ...first, endStudyGrade: "기하", endBlock: flatLessons("기하").at(-1)! });
    const algebra = planLearningGoal({ ...geometry, endStudyGrade: "대수", endBlock: flatLessons("대수").at(-1)! }, geometry);
    expect(learningGoalError(algebra)).toBeNull();
    expect(learningBlocks(algebra).slice(0, geometry.blockCount ?? 0)).toEqual(learningBlocks(geometry));
    expect(learningTopics(algebra).map((topic) => topic.grade)).toContain("기하");
    expect(goalMilestones(algebra)[0]).toEqual(goalMilestones(geometry)[0]);
  });
});
