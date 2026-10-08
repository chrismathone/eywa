import { describe, expect, it } from "vitest";
import { curriculumForGradeSemester, flatLessons } from "@/features/onescreen/curriculum";
import { buildLearningProgress, goalMilestones, learningDays, learningGoalError, learningPlannedTopic, planLearningGoal, type LearningContext } from "./learning-plan";
import { learningRailMetrics, learningMilestoneTicks, learningTargetPosition, learningTopicTicks } from "./learning-axis";
import { buildLearningMap } from "@/features/math-progress-map/learning-map";
import { reviseLearningGoal, revisionBoundary } from "./learning-revision";

const firstSemester = curriculumForGradeSemester("중1", 1).flatMap(unit => unit.lessons);
function fixture() {
  const first = planLearningGoal({ studentId: "student", studyGrade: "중1", startBlock: firstSemester[0], endBlock: firstSemester.at(-1)!,
    startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
  const goal = { ...planLearningGoal({ ...first, endBlock: flatLessons("중1").at(-1)! }, first), updatedAt: "version" };
  const records = [{ date: "2026-12-02", progress: flatLessons("중1")[firstSemester.length + 1], textbook: null }];
  const context: LearningContext = { schedules: [{ dayOfWeek: "wed", startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null }],
    holidays: { "2026-12-23": "휴강" }, spans: { student: [{ start: "2026-09-01", end: null }] } };
  const progress = buildLearningProgress(goal, context, records, "2026-12-05");
  const stops = goalMilestones(goal).map(stop => ({ ...stop }));
  stops[1] = { ...stops[1], endDate: "2027-01-31", blockCount: 18 };
  return { goal, records, context, progress, stops };
}

describe("현재 진도에서 남은 계획 수정", () => {
  it("지난 도달 목표를 보존하고 날짜·분량을 바꿔 남은 수업일에 다시 배분한다", () => {
    const f = fixture();
    expect(revisionBoundary(f.goal, f.progress, "2026-12-05").lockedStops).toBe(1);
    const result = reviseLearningGoal(f.goal, f.progress, f.stops, "새 교재", "2026-12-05");
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(result.goal.startDate).toBe(f.goal.startDate);
    expect(result.goal.milestones![0]).toEqual(f.goal.milestones![0]);
    expect(result.goal).toMatchObject({ endDate: "2027-01-31", blockCount: 18, textbook: "새 교재" });
    expect(learningGoalError(result.goal)).toBeNull();
    const days = learningDays(result.goal, f.context);
    expect(days.filter(day => day.date <= "2026-12-05").map(day => day.date)).toEqual(f.progress.days.filter(day => day.date <= "2026-12-05").map(day => day.date));
    expect(days.some(day => day.date === "2026-12-23")).toBe(false);
    expect(days.at(-1)).toMatchObject({ date: "2027-01-27", target: 18 });
    const progress = buildLearningProgress(result.goal, f.context, f.records, "2026-12-05");
    expect(progress.currentBlock).toBe(f.progress.currentBlock);
    expect(progress.currentDate).toBe(f.progress.currentDate);
    expect(learningRailMetrics(result.goal, progress).current).toBe(learningRailMetrics(f.goal, f.progress).current);
    expect(learningPlannedTopic(result.goal, progress)).toEqual(result.goal.revision!.anchor);
    expect(f.goal.revision).toBeUndefined();
  });
  it("다시 수정해도 지난 계획의 단원 위치를 다시 환산하지 않는다", () => {
    const f = fixture(), first = reviseLearningGoal(f.goal, f.progress, f.stops, null, "2026-12-05");
    if (!first.ok) throw new Error(first.error);
    const progress = buildLearningProgress(first.goal, f.context, f.records, "2026-12-12");
    const next = reviseLearningGoal(first.goal, progress, f.stops, null, "2026-12-12");
    expect(next.ok).toBe(true); if (!next.ok) return;
    expect(next.goal.revision!.pastDays.slice(0, first.goal.revision!.pastDays.length)).toEqual(first.goal.revision!.pastDays);
  });
  it("수정 이후의 계획을 앞당겨도 미학습 단원을 지난 계획일로 배치하지 않는다", () => {
    const f = fixture(), result = reviseLearningGoal(f.goal, f.progress, f.stops, null, "2026-12-05");
    if (!result.ok) throw new Error(result.error);
    const progress = buildLearningProgress(result.goal, f.context, f.records, "2026-12-05");
    const map = buildLearningMap(result.goal, progress);
    expect(map.lessons.filter(lesson => lesson.inGoal && !lesson.reached).every(lesson => lesson.plannedDate != null && lesson.plannedDate > "2026-12-05")).toBe(true);
  });
  it("지난 도달 목표의 단원·날짜·분량을 위조하거나 제거하면 거절한다", () => {
    const f = fixture();
    for (const patch of [{ endBlock: firstSemester[2] }, { endDate: "2026-11-29" }, { blockCount: 10 }])
      expect(reviseLearningGoal(f.goal, f.progress, [{ ...f.stops[0], ...patch }, f.stops[1]], null, "2026-12-05").ok).toBe(false);
    expect(reviseLearningGoal(f.goal, f.progress, [f.stops[1]], null, "2026-12-05").ok).toBe(false);
  });
  it("과정 역순·잘못된 날짜·지난 완료일·소수 분량은 거절한다", () => {
    const f = fixture();
    for (const patch of [{ endBlock: firstSemester[0] }, { endDate: "2027-02-30" }, { endDate: "2026-12-04" }, { blockCount: 18.5 }, { blockCount: 481 }])
      expect(reviseLearningGoal(f.goal, f.progress, [f.stops[0], { ...f.stops[1], ...patch }], null, "2026-12-05").ok).toBe(false);
  });
  it("수강 기간이나 휴강으로 남은 목표 구간의 수업이 없으면 배분하지 않는다", () => {
    const f = fixture(), result = reviseLearningGoal(f.goal, f.progress, f.stops, null, "2026-12-05");
    if (!result.ok) throw new Error(result.error);
    expect(learningDays(result.goal, { ...f.context, spans: { student: [{ start: "2026-09-01", end: "2026-12-04" }] } })).toEqual([]);
  });
  it("기한을 넘긴 미완료 목표도 현재 진도 이후로 다시 계획할 수 있다", () => {
    const f = fixture();
    const progress = buildLearningProgress(f.goal, f.context, [{ ...f.records[0], date: "2027-03-03" }], "2027-03-05");
    const stops = [f.stops[0], { ...f.stops[1], endDate: "2027-04-30" }];
    const result = reviseLearningGoal(f.goal, progress, stops, null, "2027-03-05");
    expect(result.ok).toBe(true); if (!result.ok) return;
    expect(learningDays(result.goal, f.context).at(-1)?.date).toBe("2027-04-28");
  });
  it("수정한 계획에 다음 목표를 확장해도 기존 날짜·배분을 보존한다", () => {
    const f = fixture(), result = reviseLearningGoal(f.goal, f.progress, f.stops, null, "2026-12-05");
    if (!result.ok) throw new Error(result.error);
    const next = planLearningGoal({ ...result.goal, endStudyGrade: "중2", endBlock: flatLessons("중2").at(-1)! }, result.goal);
    expect(learningGoalError(next)).toBeNull();
    expect(next.milestones!.slice(0, 2)).toEqual(result.goal.milestones);
    expect(next.revision).toEqual(result.goal.revision);
    const positions = (goal: typeof next) => learningDays(goal, f.context).filter(day => day.date <= result.goal.endDate).map(({ date, target, topic }) => ({ date, target, topic }));
    expect(positions(next)).toEqual(positions(result.goal));
  });
  it("복습 심화는 기한 이후의 실제 기록으로 다시 계획하고 수정 후에도 해당 기록을 유지한다", () => {
    const f = fixture();
    const goal = planLearningGoal({ ...f.goal, track: "supplement", endBlock: flatLessons("중1")[8] });
    const records = [{ date: "2026-12-02", progress: flatLessons("중1")[3], textbook: null }];
    const current = buildLearningProgress(goal, f.context, records, "2026-12-05", "2026-12", { includeAfterGoal: true });
    expect(current.currentBlock).toBe(records[0].progress);
    const revised = reviseLearningGoal(goal, current, [{ ...goalMilestones(goal)[0], endDate: "2027-01-31", blockCount: 7 }], null, "2026-12-05");
    expect(revised.ok).toBe(true); if (!revised.ok) return;
    expect(learningGoalError(revised.goal)).toBeNull();
    expect(buildLearningProgress(revised.goal, f.context, records, "2026-12-05").currentBlock).toBe(records[0].progress);
    const updated = buildLearningProgress(revised.goal, f.context, records, "2026-12-05");
    expect(updated.month.from).toBeLessThanOrEqual(updated.month.to);
    expect(updated.week.from).toBeLessThanOrEqual(updated.week.to);
    expect(learningDays(revised.goal, f.context).at(-1)?.target).toBe(7);
  });
  it("목표를 줄여도 지난 계획의 위치와 차이를 같은 눈금으로 표시한다", () => {
    const f = fixture();
    const progress = buildLearningProgress(f.goal, f.context, f.records, "2027-03-05");
    const stops = [f.stops[0], { ...f.stops[1], endBlock: flatLessons("중1")[firstSemester.length + 5], endDate: "2027-04-30" }];
    const revised = reviseLearningGoal(f.goal, progress, stops, null, "2027-03-05");
    if (!revised.ok) throw new Error(revised.error);
    const past = buildLearningProgress(revised.goal, f.context, f.records, "2027-01-31");
    const metrics = learningRailMetrics(revised.goal, past);
    expect(metrics.target).toBeGreaterThan(metrics.total);
    expect(metrics.difference).toBe(metrics.current! - metrics.target);
    expect(past.month.from).toBeLessThanOrEqual(past.month.to);
  });
  it("분량이 작아도 여러 학년에 걸친 수정 목표를 잘라내지 않는다", () => {
    const f = fixture();
    const result = reviseLearningGoal(f.goal, f.progress, [f.stops[0], { ...f.stops[1], studyGrade: "공통수학2", endBlock: flatLessons("공통수학2").at(-1)!, endDate: "2027-11-30" }], null, "2026-12-05");
    if (!result.ok) throw new Error(result.error);
    const topics = learningTopicTicks(result.goal, f.progress), stops = learningMilestoneTicks(result.goal, topics);
    expect(stops).toHaveLength(2);
    expect(learningTargetPosition(result.goal, topics)).toBe(stops.at(-1)!.position);
  });
});
