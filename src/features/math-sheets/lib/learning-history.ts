import { splitLessons } from "@/features/onescreen/curriculum";
import { monthRange, shiftMonth } from "@/lib/date-kst";
import { learningTimelineTopics, learningTimelineTopicIndex } from "./learning-path";
import type { LearningGoal, LearningHistory, LearningProgress, LearningRecord } from "./learning-plan";

/** Sent reports supply facts; only gaps between advancing reports receive estimated dates. */
export function buildLearningHistory(goal: LearningGoal, progress: LearningProgress, records: readonly LearningRecord[], enrolledAt: string | null, referenceDate: string): LearningHistory {
  const previousYearMonth = shiftMonth(referenceDate.slice(0, 7), -12);
  const yearAgo = `${previousYearMonth}-${String(Math.min(Number(referenceDate.slice(8)), Number(monthRange(previousYearMonth).to.slice(8)))).padStart(2, "0")}`;
  const fromDate = enrolledAt && enrolledAt > yearAgo ? enrolledAt : yearAgo;
  const topics = learningTimelineTopics(goal);
  const reportedDates = [...new Set(records.filter(record => record.date <= referenceDate && (!enrolledAt || record.date >= enrolledAt)).map(record => record.date))].sort();
  const observations: { index: number; date: string }[] = [];
  for (const record of [...records].sort((a, b) => a.date.localeCompare(b.date) || (a.sentAt ?? "").localeCompare(b.sentAt ?? ""))) {
    if (record.date > referenceDate || (enrolledAt && record.date < enrolledAt)) continue;
    const indices = new Set(splitLessons(record.progress).flatMap(line => {
      const index = learningTimelineTopicIndex(line, goal, topics);
      return index == null ? [] : [index];
    }));
    for (const index of [...indices].sort((a, b) => a - b)) observations.push({ index, date: record.date });
  }
  const dates = new Map<number, { date: string; estimated: boolean }>();
  for (const observation of observations) {
    const previous = dates.get(observation.index);
    if (!previous || (previous.date < fromDate && observation.date >= fromDate)) dates.set(observation.index, { date: observation.date, estimated: false });
  }
  for (let i = 1; i < observations.length; i++) {
    const before = observations[i - 1], after = observations[i];
    if (after.index <= before.index || after.date === before.date) continue;
    // 수업이 확인되지 않은 달력 날짜에 진도를 만들어 넣지 않는다.
    // 단원을 특정할 수 없는 시험·복습 보고서도 실제 수업일의 근거가 된다.
    const days = reportedDates.filter(date => date > before.date && date <= after.date);
    for (let index = before.index + 1; index < after.index; index++) {
      const date = days[Math.ceil(days.length * (index - before.index) / (after.index - before.index)) - 1];
      if (date && !dates.has(index)) dates.set(index, { date, estimated: true });
    }
  }
  const recent = observations.filter(item => item.date >= fromDate);
  const dated = [...dates].filter(([, value]) => value.date >= fromDate);
  const currentIndex = learningTimelineTopicIndex(progress.currentBlock, goal, topics);
  const candidates = [...recent.map(item => item.index), ...dated.map(([index]) => index), ...(currentIndex == null ? [] : [currentIndex])];
  const fallback = topics.findIndex(topic => topic.grade === goal.studyGrade && topic.lesson === goal.startBlock);
  const startIndex = candidates.length ? Math.min(...candidates) : fallback;
  // A short report archive does not mean an established student enrolled recently.
  const canLocateStart = Boolean(enrolledAt && enrolledAt > yearAgo) || observations.some(item => item.date <= fromDate);
  return {
    enrolledAt, fromDate,
    start: !canLocateStart || startIndex < 0 ? null : { grade: topics[startIndex].grade, lesson: topics[startIndex].lesson },
    lessons: dated.sort(([a], [b]) => a - b).map(([index, value]) => ({ grade: topics[index].grade, lesson: topics[index].lesson, ...value })),
  };
}
