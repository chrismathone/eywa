import { learningRailMetrics, learningTopicTicks } from "@/features/math-sheets/lib/learning-axis";
import { learningTopicPositions, validPlanDate, type LearningGoal, type LearningProgress } from "@/features/math-sheets/lib/learning-plan";
import { learningBlockLabel } from "@/features/math-sheets/lib/learning-label";
import { daysInMonth, weeksOfMonth, ymd } from "./calendar";

export type LearningMapLesson = ReturnType<typeof learningTopicTicks>[number] & {
  label: string;
  plannedDate: string | null;
  /** Report-backed study date, otherwise the plan for an unreached lesson. Unknown completed dates stay null. */
  calendarDate: string | null;
  reached: boolean | null;
  inGoal: boolean;
};

/** One ledger per visible curriculum lesson. The bar remains the source of all cumulative metrics. */
export function buildLearningMap(goal: LearningGoal, progress: LearningProgress) {
  const topics = learningTopicTicks(goal, progress);
  const metrics = learningRailMetrics(goal, progress, topics);
  const course = new Map(learningTopicPositions(goal).map(topic => [`${topic.grade}:${topic.lesson}`, topic.block]));
  const anchorIndex = goal.revision?.anchor ? topics.findIndex(item => item.grade === goal.revision!.anchor!.grade && item.lesson === goal.revision!.anchor!.lesson) : -1;
  const lessons: LearningMapLesson[] = topics.map(topic => {
    const block = course.get(`${topic.grade}:${topic.lesson}`);
    const planDays = goal.revision && topic.position > anchorIndex + 1 ? progress.days.filter(day => day.date > goal.revision!.effectiveDate) : progress.days;
    const plannedDate = block == null ? null : planDays.find(day => day.target >= block)?.date ?? null;
    const reached = metrics.current == null ? null : topic.position <= metrics.current;
    return { ...topic, label: learningBlockLabel(topic.lesson, topic.grade), plannedDate,
      // 실제 진도는 보고서의 수업일에 놓는다. 날짜를 모르는 완료 차시는 계획일로 꾸미지 않는다.
      calendarDate: topic.date ?? (reached ? null : plannedDate),
      reached,
      inGoal: topic.position <= metrics.total };
  });
  const referenceDate = progress.referenceDate ?? goal.startDate;
  const dates = [referenceDate, goal.startDate, goal.endDate, ...lessons.flatMap(lesson => [lesson.calendarDate, lesson.date].filter((d): d is string => Boolean(d)))].sort();
  const firstYear = Number(dates[0].slice(0, 4)), lastYear = Number(dates.at(-1)!.slice(0, 4));
  return { lessons, metrics, referenceDate, years: Array.from({ length: lastYear - firstYear + 1 }, (_, i) => firstYear + i) };
}
export type LearningMap = ReturnType<typeof buildLearningMap>;
export type MapMode = "year" | "quarter" | "month" | "week" | "day";
export type MapSelection = { mode: MapMode; date: string; lesson: number | null; undated: boolean };
export type MapPeriod = { from: string; to: string; label: string; mode: MapMode };
const modes: MapMode[] = ["year", "quarter", "month", "week", "day"];

export function readMapSelection(params: Pick<URLSearchParams, "get">, map: LearningMap): MapSelection {
  const raw = params.get("date") ?? "";
  const date = validPlanDate(raw) && map.years.includes(Number(raw.slice(0, 4))) ? raw : map.referenceDate;
  const mode = params.get("view") as MapMode;
  const topic = params.get("topic");
  const lesson = topic ? map.lessons.find(lesson => `${lesson.grade}:${lesson.lesson}` === topic)?.position ?? 0 : Number(params.get("lesson"));
  return { date, mode: modes.includes(mode) ? mode : "year", undated: params.get("undated") === "1",
    lesson: Number.isInteger(lesson) && lesson > 0 && lesson <= map.lessons.length ? lesson : null };
}

export function mapPeriod(selection: Pick<MapSelection, "date" | "mode">): MapPeriod {
  const { date, mode } = selection;
  const year = Number(date.slice(0, 4)), month = Number(date.slice(5, 7));
  if (mode === "year") return { from: ymd(year, 1, 1), to: ymd(year, 12, 31), label: `${year}년`, mode };
  if (mode === "quarter") {
    const q = Math.floor((month - 1) / 3);
    return { from: ymd(year, q * 3 + 1, 1), to: ymd(year, q * 3 + 3, daysInMonth(year, q * 3 + 3)), label: `${year}년 ${q + 1}분기`, mode };
  }
  if (mode === "month") return { from: ymd(year, month, 1), to: ymd(year, month, daysInMonth(year, month)), label: `${year}년 ${month}월`, mode };
  if (mode === "week") {
    const week = weeksOfMonth(year, month).find(week => week.start <= date && date <= week.end)!;
    return { from: week.start, to: week.end, label: `${month}월 ${week.index}주`, mode };
  }
  return { from: date, to: date, label: date, mode };
}

/** Child periods partition their parent, including short weeks and leap days. */
export function mapChildren(period: MapPeriod): MapPeriod[] {
  const year = Number(period.from.slice(0, 4)), month = Number(period.from.slice(5, 7));
  if (period.mode === "year") return [1, 4, 7, 10].map(m => mapPeriod({ date: ymd(year, m, 1), mode: "quarter" }));
  if (period.mode === "quarter") return [month, month + 1, month + 2].map(m => mapPeriod({ date: ymd(year, m, 1), mode: "month" }));
  if (period.mode === "month") return weeksOfMonth(year, month).map(week => mapPeriod({ date: week.start, mode: "week" }));
  if (period.mode === "week") return weeksOfMonth(year, month).find(week => week.start === period.from)!.days.map(date => mapPeriod({ date, mode: "day" }));
  return [];
}

export function lessonsInPeriod(map: LearningMap, period: MapPeriod, undated = false): LearningMapLesson[] {
  return map.lessons.filter(lesson => lesson.inGoal && (undated ? !lesson.calendarDate
    : lesson.calendarDate != null && lesson.calendarDate >= period.from && lesson.calendarDate <= period.to));
}

export function periodMetrics(lessons: LearningMapLesson[], known: boolean) {
  const total = lessons.length;
  const current = known ? lessons.filter(lesson => lesson.reached).length : null;
  return { total, current, percent: current == null || !total ? null : Math.round(current / total * 100) };
}

export function learningMapHref(classId: string, studentId: string, month: string) {
  return learningSheetHref(classId, studentId, month);
}

export function learningSheetHref(classId: string, studentId: string, month: string) {
  return `/mcs/${encodeURIComponent(classId)}/month?${new URLSearchParams({ month, student: studentId })}`;
}
