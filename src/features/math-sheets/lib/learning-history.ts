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
  const firstIndex = candidates.length ? Math.min(...candidates) : fallback;
  // 첫 기록이 이미 목표 끝을 지났으면 목표 구간을 레일에 남긴다(목표 시작부터) — 목표를 다 지났다는 게 기록으로 증명된 구간이라
  // 억지 표시가 아니고, 잘라 버리면 목표가 0차시가 되어 '3 / 0차시'·'—'가 선다(재리뷰 2026-09-21).
  const goalEnd = topics.findIndex(topic => topic.grade === (goal.endStudyGrade ?? goal.studyGrade) && topic.lesson === goal.endBlock);
  const startIndex = fallback >= 0 && goalEnd >= 0 && firstIndex > goalEnd ? fallback : firstIndex;
  // 선은 등록 이후 기록이 처음 닿은 차시에서 시작한다 — 원장 2026-09-21 "수업 등록일 이전의 진도 부분은 억지로 표시 안해도 됨".
  // 🔴 오래 다닌 학생이라고 앞 두 학기를 '다녀온 구간'으로 칠하지 말 것(보고서가 1년보다 짧게 남은 학생이 그렇게 그려졌다 —
  //    김민찬: 2024-12 등록 · 이 반 첫 보고서 2026-04-03 중1 1학기 '소수와 거듭제곱·소인수분해'인데 초6 1학기부터 파랗게 찼다).
  //    ⚠️ 시작은 날짜순 첫 기록이 아니라 1년 창 안에서 **가장 앞선 차시**다(복습 한 줄이 시작을 당길 수 있다 — 종전 규칙 그대로).
  return {
    enrolledAt, fromDate,
    start: startIndex < 0 ? null : { grade: topics[startIndex].grade, lesson: topics[startIndex].lesson },
    lessons: dated.sort(([a], [b]) => a - b).map(([index, value]) => ({ grade: topics[index].grade, lesson: topics[index].lesson, ...value })),
  };
}
