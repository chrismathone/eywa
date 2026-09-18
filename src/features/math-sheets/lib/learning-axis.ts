import { goalMilestones, learningTopicPositions, type LearningGoal, type LearningProgress } from "./learning-plan";
import { learningTimelineTopics, learningTimelineTopicIndex, topicSegments } from "./learning-path";

/** Maximum lesson spacing; available width sets a shared scale for every student in the view. */
export const LEARNING_LESSON_WIDTH = 12;

/** Two previous semesters plus the current semester and the next three; electives stay explicit. */
export function learningTopicTicks(goal: LearningGoal, progress?: LearningProgress) {
  const full = learningTimelineTopics(goal);
  const currentIndex = learningTimelineTopicIndex(progress?.currentBlock ?? null, goal, full);
  const anchorIndex = currentIndex ?? full.findIndex(topic => topic.grade === goal.studyGrade && topic.lesson === goal.startBlock);
  if (anchorIndex < 0) return [];
  const anchor = full[anchorIndex];
  const semesters = topicSegments(full);
  const semesterIndex = semesters.findIndex(topics => topics[0].grade === anchor.grade && topics[0].semester === anchor.semester);
  const window = semesters.slice(Math.max(0, semesterIndex - 2), semesterIndex + 4).flat();
  const start = progress?.history?.start;
  const historyStart = start ? window.findIndex(topic => topic.grade === start.grade && topic.lesson === start.lesson) : -1;
  const dates = new Map(progress?.history?.lessons.map(lesson => [`${lesson.grade}:${lesson.lesson}`, lesson]));
  return window.slice(Math.max(0, historyStart)).map((topic, index) => ({
    ...topic, position: index + 1, date: dates.get(`${topic.grade}:${topic.lesson}`)?.date,
    estimated: dates.get(`${topic.grade}:${topic.lesson}`)?.estimated,
  }));
}

export function learningGoalTicks(goal: LearningGoal, topics = learningTopicTicks(goal)) {
  const saved = goalMilestones(goal);
  return topicSegments(topics).map((semester, index) => {
    const last = semester.at(-1)!;
    const stop = saved.findLast(item => item.studyGrade === last.grade && semester.some(topic => topic.lesson === item.endBlock));
    const endBlock = stop?.endBlock ?? last.lesson;
    const tick = topics.find(topic => topic.grade === last.grade && topic.lesson === endBlock)!;
    const semesterEnd = topics.find(topic => topic.grade === last.grade && topic.lesson === last.lesson)!;
    return {
      number: index + 1, goalNumber: stop ? saved.indexOf(stop) + 1 : null, studyGrade: last.grade, semester: last.semester, endBlock,
      semesterEndPosition: semesterEnd.position,
      position: tick.position, hasGoal: Boolean(stop), observedDate: semesterEnd.date, estimated: semesterEnd.estimated,
      endDate: stop?.endDate ?? null, blockCount: stop?.blockCount ?? null,
    };
  });
}

/** Multiple saved goals may share a semester, especially in review classes. Keep every one. */
export function learningMilestoneTicks(goal: LearningGoal, topics = learningTopicTicks(goal)) {
  return goalMilestones(goal).flatMap((stop, index) => {
    const topic = topics.find(topic => topic.grade === stop.studyGrade && topic.lesson === stop.endBlock);
    return topic ? [{ ...stop, position: topic.position, goalNumber: index + 1 }] : [];
  });
}

/** Number of visible lesson intervals from the displayed start to the red endpoint. */
export function learningTargetPosition(goal: LearningGoal, topics = learningTopicTicks(goal)): number {
  if (!topics.length) return 0;
  const full = learningTimelineTopics(goal);
  const start = full.findIndex(topic => topic.grade === topics[0].grade && topic.lesson === topics[0].lesson);
  const end = full.findIndex(topic => topic.grade === (goal.endStudyGrade ?? goal.studyGrade) && topic.lesson === goal.endBlock);
  return Math.max(0, Math.min(topics.length, end - start + 1));
}

export type LearningRailMetrics = Pick<LearningProgress, "current" | "total" | "target" | "percent" | "difference" | "remainingDays" | "requiredPace" | "status">;

/** Every visible statistic uses the same lesson ruler; stored teaching blocks only provide the schedule. */
export function learningRailMetrics(goal: LearningGoal, progress: LearningProgress, topics = learningTopicTicks(goal, progress)): LearningRailMetrics {
  const total = learningTargetPosition(goal, topics);
  const current = learningCurrentPosition(goal, progress, topics);
  const course = learningTopicPositions(goal);
  const full = learningTimelineTopics(goal);
  const displayStart = topics.length ? full.findIndex(topic => topic.grade === topics[0].grade && topic.lesson === topics[0].lesson) : 0;
  const planned = course.findLast(topic => topic.block <= progress.target);
  const plannedIndex = planned
    ? full.findIndex(topic => topic.grade === planned.grade && topic.lesson === planned.lesson)
    : full.findIndex(topic => topic.grade === goal.studyGrade && topic.lesson === goal.startBlock) - 1;
  const target = Math.max(0, Math.min(total, plannedIndex - displayStart + 1));
  const last = topics[total - 1];
  const lastBlock = last ? course.find(topic => topic.grade === last.grade && topic.lesson === last.lesson)?.block : null;
  const deadline = lastBlock == null ? goal.endDate : progress.days.find(day => day.target >= lastBlock)?.date ?? goal.endDate;
  const remainingDays = progress.referenceDate
    ? progress.days.filter(day => day.date > progress.referenceDate! && day.date <= deadline).length
    : progress.remainingDays;
  const difference = current == null ? null : current - target;
  const status = ["no-schedule", "not-started"].includes(progress.status) ? progress.status
    : current == null || !total ? "no-data" : current >= total ? "done"
    : difference! < -1 ? "behind" : difference! > 1 ? "ahead" : "on";
  return {
    current, total, target, difference, remainingDays, status,
    percent: current == null || !total ? null : Math.round(current / total * 100),
    requiredPace: current == null || !remainingDays ? null : Math.max(0, total - current) / remainingDays,
  };
}

/** The curriculum ruler shows a lesson's location, including in classes that count review days. */
export function learningCurrentPosition(goal: LearningGoal, progress: LearningProgress | undefined, topics = learningTopicTicks(goal, progress)): number | null {
  const index = learningTimelineTopicIndex(progress?.currentBlock ?? null, goal, topics);
  if (index != null) return topics[index].position;
  // Counts and plan boundaries say nothing about a lesson's position in this moving window.
  return null;
}
