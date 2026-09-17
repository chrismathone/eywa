import { flatLessons, splitLessons, semesterOfLesson } from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE, type MathLearningTrack } from "@/features/progress/learning-cadence";
import { addDays, monthRange, shiftMonth } from "@/lib/date-kst";
import { classDaysOf, type MathScheduleRow } from "./class-days";
import type { EnrollSpan } from "@/features/attendance/enrollment-span";
import { dowKeyOf } from "@/features/class-sheets/lib/week";

/** A goal is stored once; monthly, weekly and daily targets are derived, never copied into reports. */
export type LearningGoal = {
  studentId: string;
  studyGrade: string;
  startBlock: string;
  endBlock: string;
  startDate: string;
  endDate: string;
  textbook: string | null;
  track?: MathLearningTrack;
  /** Absent only on goals saved before the 24-block semester plan. */
  blockCount?: number | null;
};
export type LearningRecord = {
  date: string;
  progress: string | null;
  textbook: string | null;
  homework?: string | null;
};
export type LearningStatus =
  | "no-goal"
  | "no-data"
  | "no-schedule"
  | "not-started"
  | "behind"
  | "on"
  | "ahead"
  | "done";
export type PlannedDay = { date: string; target: number; block: string | null };
export type LearningProgress = {
  total: number;
  current: number | null;
  currentBlock: string | null;
  currentDate: string | null;
  target: number;
  difference: number | null;
  status: LearningStatus;
  percent: number | null;
  targetPercent: number;
  remainingDays: number;
  requiredPace: number | null;
  month: { from: number; to: number; endDate: string };
  week: { from: number; to: number; endDate: string };
  days: PlannedDay[];
};
export type LearningContext = {
  schedules: MathScheduleRow[];
  holidays: Record<string, string>;
  spans: Record<
    string,
    Array<EnrollSpan & { attendanceDays?: string[] | null }>
  >;
};
export type LearningData = {
  goals: Record<string, LearningGoal>;
  progress: Record<string, LearningProgress>;
  records: Record<string, LearningRecord[]>;
  status: "ok" | "missing-table" | "failed";
  referenceDate: string;
  context: LearningContext;
  track?: MathLearningTrack;
  supplement?: Pick<LearningData, "goals" | "progress" | "records">;
};

export function standardGoalDates(month: string, track: MathLearningTrack) {
  return {
    startDate: `${month}-01`,
    endDate: monthRange(shiftMonth(month, MATH_LEARNING_CADENCE[track].months - 1)).to,
  };
}

/** One course interval is divided into teaching blocks without changing the source curriculum. */
export function learningBlocks(goal: LearningGoal): string[] {
  const topics = goalBlocks(goal);
  if (!goal.blockCount || !topics.length) return topics;
  return Array.from({ length: goal.blockCount }, (_, index) => {
    const from = Math.floor((topics.length * index) / goal.blockCount!);
    const to = Math.max(from, Math.ceil((topics.length * (index + 1)) / goal.blockCount!) - 1);
    return from === to ? topics[from]! : `${topics[from]} ~ ${topics[to]}`;
  });
}

export function isLearningTrackDate(date: string, track: MathLearningTrack = "regular") {
  return (dowKeyOf(date) === "wed") === (track === "supplement");
}

export function validPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function goalBlocks(
  goal: Pick<LearningGoal, "studyGrade" | "startBlock" | "endBlock">,
): string[] {
  const blocks = flatLessons(goal.studyGrade);
  const start = blocks.indexOf(goal.startBlock),
    end = blocks.indexOf(goal.endBlock);
  return start < 0 || end < start ? [] : blocks.slice(start, end + 1);
}

export function learningGoalError(goal: LearningGoal): string | null {
  if (!validPlanDate(goal.startDate) || !validPlanDate(goal.endDate))
    return "시작일과 완료 예정일을 확인해 주세요.";
  if (goal.startDate > goal.endDate)
    return "완료 예정일은 시작일 이후로 정해 주세요.";
  if (goal.endDate > addDays(goal.startDate, 730))
    return "전체 목표 기간은 2년 이내로 설정해 주세요.";
  if (!goalBlocks(goal).length)
    return "같은 과정에서 시작 블록과 그 이후의 목표 블록을 선택해 주세요.";
  if ((goal.textbook?.length ?? 0) > 500)
    return "교재 이름은 500자 이내로 입력해 주세요.";
  if (goal.blockCount != null) {
    const track = goal.track ?? "regular";
    const policy = MATH_LEARNING_CADENCE[track];
    const dates = standardGoalDates(goal.startDate.slice(0, 7), track);
    if (goal.blockCount !== policy.totalBlocks || goal.startDate !== dates.startDate || goal.endDate !== dates.endDate)
      return track === "regular" ? "정규 목표는 시작 월부터 3개월·24블록으로 설정해 주세요." : "수요일 목표는 한 달·4블록으로 설정해 주세요.";
    if (track === "regular" && semesterOfLesson(goal.studyGrade, goal.startBlock) !== semesterOfLesson(goal.studyGrade, goal.endBlock))
      return "정규 목표는 같은 학기의 시작·완료 단원으로 설정해 주세요.";
  }
  return null;
}

export function learningDays(
  goal: LearningGoal,
  context: LearningContext,
): PlannedDay[] {
  if (learningGoalError(goal)) return [];
  const dates: string[] = [];
  const spans = context.spans[goal.studentId] ?? [];
  for (
    let month = goal.startDate.slice(0, 7);
    month <= goal.endDate.slice(0, 7);
    month = shiftMonth(month, 1)
  ) {
    for (const { date } of classDaysOf(month, context.schedules)) {
      if (
        date < goal.startDate ||
        date > goal.endDate ||
        context.holidays[date] ||
        !isLearningTrackDate(date, goal.track)
      )
        continue;
      if (
        !spans.some(
          (s) =>
            s.start <= date &&
            (s.end == null || date <= s.end) &&
            (!s.attendanceDays?.length ||
              s.attendanceDays.includes(dowKeyOf(date))),
        )
      )
        continue;
      dates.push(date);
    }
  }
  const blocks = learningBlocks(goal);
  if (goal.blockCount != null) {
    const policy = MATH_LEARNING_CADENCE[goal.track ?? "regular"];
    const groups = Array.from({ length: policy.months }, (_, index) => {
      const month = shiftMonth(goal.startDate.slice(0, 7), index);
      return dates.filter((date) => date.startsWith(month));
    });
    // A missing month cannot silently count as eight completed teaching blocks.
    if (groups.some((group) => !group.length)) return [];
    return groups.flatMap((group, monthIndex) => group.map((date, dayIndex) => {
      const target = monthIndex * policy.monthlyBlocks + Math.ceil(policy.monthlyBlocks * (dayIndex + 1) / group.length);
      return { date, target, block: blocks[target - 1] ?? null };
    }));
  }
  return dates.map((date, i) => {
    const target = Math.floor((blocks.length * (i + 1)) / dates.length);
    return { date, target, block: blocks[target - 1] ?? null };
  });
}

/** Same-course lookup also handles high-school courses without changing the legacy global timeline. */
export function recordBlockIndex(
  progress: string | null,
  studyGrade: string,
): number | null {
  const blocks = flatLessons(studyGrade);
  let best: number | null = null;
  for (const line of splitLessons(progress)) {
    let candidate = line.replace(/^\d+\.\s*/, "").trim();
    for (let i = 0; i < 5; i++) {
      const index = blocks.indexOf(candidate);
      if (index >= 0) {
        best = Math.max(best ?? -1, index);
        break;
      }
      const space = candidate.indexOf(" ");
      if (space < 0) break;
      candidate = candidate.slice(space + 1).trim();
    }
  }
  return best;
}

export function plannedAt(days: readonly PlannedDay[], date: string): number {
  let target = 0;
  for (const day of days) {
    if (day.date > date) break;
    target = day.target;
  }
  return target;
}

export function buildLearningProgress(
  goal: LearningGoal,
  context: LearningContext,
  records: readonly LearningRecord[],
  referenceDate: string,
  planMonth = referenceDate.slice(0, 7),
): LearningProgress {
  const days = learningDays(goal, context),
    blocks = learningBlocks(goal),
    total = blocks.length;
  const course = flatLessons(goal.studyGrade),
    start = course.indexOf(goal.startBlock);
  let current: number | null = null,
    currentBlock: string | null = null,
    currentDate: string | null = null;
  const topicCount = goalBlocks(goal).length;
  const reviewDates = new Set<string>();
  const plannedDates = new Set(days.map((day) => day.date));
  // Latest position wins, including a return to earlier blocks for revision. Future reports never count.
  for (const record of [...records].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (record.date < goal.startDate || record.date > referenceDate || !isLearningTrackDate(record.date, goal.track)) continue;
    if (goal.track === "supplement") {
      if (record.date > goal.endDate || !plannedDates.has(record.date) || !record.progress?.trim()) continue;
      reviewDates.add(record.date);
      current = Math.min(total, reviewDates.size);
      currentBlock = record.progress.trim();
      currentDate = record.date;
      continue;
    }
    const index = recordBlockIndex(record.progress, goal.studyGrade);
    if (index == null) continue;
    const position = goal.blockCount && topicCount ? ((index - start + 1) / topicCount) * total : index - start + 1;
    current = Math.round(Math.max(0, Math.min(total, position)) * 10) / 10;
    currentBlock = course[index] ?? null;
    currentDate = record.date;
  }
  const target = plannedAt(days, referenceDate),
    difference = current == null ? null : Math.round((current - target) * 10) / 10;
  const remainingDays = days.filter((d) => d.date > referenceDate).length;
  const range = monthRange(planMonth);
  const dow = new Date(`${referenceDate}T00:00:00Z`).getUTCDay();
  const monday = addDays(referenceDate, -((dow + 6) % 7)),
    sunday = addDays(monday, 6);
  const status: LearningStatus = !days.length
    ? "no-schedule"
    : referenceDate < days[0]!.date
      ? "not-started"
      : current == null
        ? "no-data"
        : current >= total
          ? "done"
          : difference! < -1
            ? "behind"
            : difference! > 1
              ? "ahead"
              : "on";
  return {
    total,
    current,
    currentBlock,
    currentDate,
    target,
    difference,
    status,
    percent:
      current == null || total === 0
        ? null
        : Math.round((current / total) * 100),
    targetPercent: total ? Math.round((target / total) * 100) : 0,
    remainingDays,
    requiredPace:
      current == null || !remainingDays
        ? null
        : (total - current) / remainingDays,
    month: {
      from: plannedAt(days, addDays(range.from, -1)),
      to: plannedAt(days, range.to),
      endDate: range.to,
    },
    week: {
      from: plannedAt(days, addDays(monday, -1)),
      to: plannedAt(days, sunday),
      endDate: sunday,
    },
    days,
  };
}

export function learningStatusLabel(
  progress: LearningProgress | undefined,
): string {
  if (!progress) return "전체 목표 없음";
  switch (progress.status) {
    case "no-data":
      return "진도 확인 필요";
    case "no-schedule":
      return "수업 일정 없음";
    case "not-started":
      return "시작 예정";
    case "done":
      return "목표 도달";
    case "behind":
      return `${Math.abs(progress.difference ?? 0)}블록 느림`;
    case "ahead":
      return `${progress.difference}블록 빠름`;
    default:
      return "계획대로";
  }
}
