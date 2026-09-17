import { flatLessons, splitLessons } from "@/features/onescreen/curriculum";
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
};

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
        context.holidays[date]
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
  const blocks = goalBlocks(goal);
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
    blocks = goalBlocks(goal),
    total = blocks.length;
  const course = flatLessons(goal.studyGrade),
    start = course.indexOf(goal.startBlock);
  let current: number | null = null,
    currentBlock: string | null = null,
    currentDate: string | null = null;
  // Latest position wins, including a return to earlier blocks for revision. Future reports never count.
  for (const record of [...records].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (record.date < goal.startDate || record.date > referenceDate) continue;
    const index = recordBlockIndex(record.progress, goal.studyGrade);
    if (index == null) continue;
    current = Math.max(0, Math.min(total, index - start + 1));
    currentBlock = course[index] ?? null;
    currentDate = record.date;
  }
  const target = plannedAt(days, referenceDate),
    difference = current == null ? null : current - target;
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
