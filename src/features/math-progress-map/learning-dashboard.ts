import type { LearningContext, LearningGoal, LearningProgress, LearningRecord } from "@/features/math-sheets/lib/learning-plan";
import { learningClassDates } from "@/features/math-sheets/lib/learning-class-dates";
import type { LearningMap, LearningMapLesson } from "./learning-map";
import type { DailyProgress, ProgressYear, RoadmapStep, StudentProgress } from "./model";
import { MATH_CURRICULUM } from "@/features/onescreen/curriculum";

export const semesterLabel = (lesson: LearningMapLesson) => lesson.label.split(",")[0];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].join(" · ");
const units = new Map(Object.entries(MATH_CURRICULUM).flatMap(([grade, units]) => units.flatMap(unit => unit.lessons.map(lesson => [`${grade}:${lesson}`, unit.unit] as const))));
export const unitOfLesson = (lesson: LearningMapLesson) => units.get(`${lesson.grade}:${lesson.lesson}`) ?? lesson.lesson;

/** Adapt the canonical lesson ledger to all three existing maps. Never synthesize pages or teaching days. */
export function buildLearningDashboard(student: { studentId: string; name: string; grade: string | null },
  goal: LearningGoal, progress: LearningProgress, records: LearningRecord[], map: LearningMap, context?: LearningContext): StudentProgress {
  const byDate = new Map<string, LearningMapLesson[]>();
  for (const lesson of map.lessons) {
    if (!lesson.inGoal || !lesson.calendarDate) continue;
    const group = byDate.get(lesson.calendarDate) ?? [];
    group.push(lesson); byDate.set(lesson.calendarDate, group);
  }
  // Reports without a curriculum match (exams, reviews) remain visible without inventing covered lessons.
  for (const record of records) if (!byDate.has(record.date)) byDate.set(record.date, []);
  const daily: DailyProgress[] = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, lessons]) => {
    const evidence = records.filter(record => record.date === date);
    const positions = lessons.map(lesson => lesson.position);
    const done = lessons.filter(lesson => lesson.reached).length;
    return { date, bookName: unique(evidence.map(record => record.textbook || "")) || goal.textbook || "",
      chapter: unique(lessons.map(unitOfLesson)), subChapter: unique(lessons.map(lesson => lesson.label.split(",").slice(1).join(",").trim())) || unique(evidence.map(record => record.progress || "")),
      // Legacy coordinates are used only for selecting positions; counts use the explicit ledger below.
      startPage: positions[0] ?? 0, endPage: positions.at(-1) ?? 0, completedPage: 0,
      lessons: { positions, done, known: map.metrics.current != null },
      status: !positions.length ? evidence.length ? "in-progress" : "no-plan" : done === positions.length ? "completed" : done > 0 ? "in-progress" : "not-started",
      note: unique(evidence.map(record => record.progress || "")) || undefined };
  });
  const year = Number(map.referenceDate.slice(0, 4));
  const years: ProgressYear[] = map.years.map(year => {
    const dailyProgress = daily.filter(day => day.date.startsWith(`${year}-`));
    const calendar = context ? { daysOff: context.holidays,
      classDates: context.schedules.length ? learningClassDates(student.studentId, context, `${year}-01-01`, `${year}-12-31`) : undefined } : undefined;
    return { year, dailyProgress, calendar, yearPlan: Array.from({ length: 12 }, (_, i) => i + 1).flatMap(month => {
      const prefix = `${year}-${String(month).padStart(2, "0")}`;
      const lessons = map.lessons.filter(lesson => lesson.inGoal && lesson.calendarDate?.startsWith(prefix));
      if (!lessons.length) return [];
      return [{ month, bookName: goal.textbook || "", semester: unique(lessons.map(semesterLabel)),
        chapter: unique(lessons.map(unitOfLesson)),
        startPage: lessons[0].position, endPage: lessons.at(-1)!.position }];
    }) };
  });
  const semesters = new Map<string, LearningMapLesson[]>();
  for (const lesson of map.lessons.filter(lesson => lesson.inGoal)) {
    const key = `${lesson.grade}:${lesson.semester}`;
    semesters.set(key, [...(semesters.get(key) ?? []), lesson]);
  }
  const steps: RoadmapStep[] = [...semesters].map(([id, lessons]) => {
    const dates = lessons.flatMap(lesson => lesson.calendarDate ? [lesson.calendarDate] : []).sort();
    return { id, label: semesterLabel(lessons[0]), group: lessons[0].grade,
      startMonth: dates[0]?.slice(0, 7) ?? "", endMonth: dates.at(-1)?.slice(0, 7) ?? "",
      estimated: lessons.some(lesson => lesson.estimated || !lesson.date),
      description: `${lessons[0].label.split(",").slice(1).join(",").trim()} ~ ${lessons.at(-1)!.label.split(",").slice(1).join(",").trim()}` };
  });
  const current = map.lessons.find(lesson => lesson.position === map.metrics.current);
  const source = years.find(item => item.year === year)!;
  return { ...source, studentId: student.studentId, studentName: student.name, grade: student.grade || "", asOf: map.referenceDate,
    learningMap: map, years, curriculum: { bookId: "", bookName: progress.latestRecord?.textbook || goal.textbook || "",
      semester: current ? semesterLabel(current) : "", chapter: current?.label ?? "진도 확인 필요", subChapter: "",
      currentPage: map.metrics.current ?? 0, totalPages: map.metrics.total, chapters: [] },
    plan: { startDate: goal.startDate, targetDate: goal.endDate, startPage: 0, targetPage: map.metrics.total },
    curriculumPath: [], currentStepId: current ? `${current.grade}:${current.semester}` : "",
    roadmap: { enrolledOn: progress.history?.enrolledAt || "", targetLabel: steps.at(-1)?.label || "", estimateNote: "", steps } };
}

export function progressUnit(progress: StudentProgress) { return progress.learningMap ? "차시" : "쪽"; }
export function knownProgress(progress: StudentProgress) { return !progress.learningMap || progress.learningMap.metrics.current != null; }
export function periodPercent(progress: StudentProgress, pct: number, total: number) {
  return !knownProgress(progress) || total === 0 ? "—" : `${pct}%`;
}
export function periodCount(progress: StudentProgress, done: number, total: number) {
  return `${knownProgress(progress) ? done : "—"} / ${total}${progressUnit(progress)}`;
}
