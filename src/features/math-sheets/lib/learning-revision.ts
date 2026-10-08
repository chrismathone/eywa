import { goalMilestones, learningGoalError, learningTopicPositions, normalizeLearningGoal, type LearningGoal, type LearningProgress } from "./learning-plan";
import { learningTimelineTopics, learningTimelineTopicIndex, type LearningMilestone } from "./learning-path";

/** Only elapsed, reached stops are historical. Overdue unfinished goals remain editable. */
export function revisionBoundary(goal: LearningGoal, progress: LearningProgress, today: string) {
  const timeline = learningTimelineTopics(goal);
  const current = learningTimelineTopicIndex(progress.currentBlock, goal, timeline);
  const anchor = current == null ? null : { grade: timeline[current].grade, lesson: timeline[current].lesson };
  let lockedStops = 0;
  for (const stop of goalMilestones(goal)) {
    const position = timeline.findIndex(topic => topic.grade === stop.studyGrade && topic.lesson === stop.endBlock);
    if (stop.endDate > today || current == null || position > current) break;
    lockedStops++;
  }
  return { anchor, lockedStops };
}

export function reviseLearningGoal(saved: LearningGoal, progress: LearningProgress, stops: LearningMilestone[], textbook: string | null, today: string): { ok: true; goal: LearningGoal } | { ok: false; error: string } {
  const previous = normalizeLearningGoal(saved);
  const oldStops = goalMilestones(previous);
  const { anchor, lockedStops } = revisionBoundary(previous, progress, today);
  if (!stops.length || stops.length > 100 || stops.length < lockedStops)
    return { ok: false, error: "목표를 한 개 이상 남겨 주세요." };
  if (oldStops.slice(0, lockedStops).some((stop, index) => stop.studyGrade !== stops[index].studyGrade || stop.endBlock !== stops[index].endBlock
    || stop.endDate !== stops[index].endDate || stop.blockCount !== stops[index].blockCount))
    return { ok: false, error: "지난 수업에서 도달한 목표는 유지해 주세요." };
  const course = learningTopicPositions(previous);
  const last = stops.at(-1)!;
  const goal: LearningGoal = { ...previous, textbook, endStudyGrade: last.studyGrade, endBlock: last.endBlock,
    endDate: last.endDate, blockCount: last.blockCount, milestones: stops,
    revision: { effectiveDate: today, anchor, lockedStops,
      pastDays: progress.days.filter(day => day.date <= today).map(day => {
        const topic = day.topic === undefined ? course.findLast(topic => topic.block <= day.target) : day.topic;
        return { date: day.date, topic: topic ? { grade: topic.grade, lesson: topic.lesson } : null };
      }) } };
  const error = learningGoalError(goal);
  return error ? { ok: false, error } : { ok: true, goal };
}
