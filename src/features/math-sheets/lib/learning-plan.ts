import { flatLessons, splitLessons } from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE, type MathLearningTrack } from "@/features/progress/learning-cadence";
import { addDays, monthRange, shiftMonth } from "@/lib/date-kst";
import { classDaysOf, type MathScheduleRow } from "./class-days";
import type { EnrollSpan } from "@/features/attendance/enrollment-span";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { learningTopics, learningTopicIndex, topicSegments, type LearningMilestone, type LearningTopic } from "./learning-path";

/** A goal is stored once; monthly, weekly and daily targets are derived, never copied into reports. */
export type LearningGoal = {
  studentId: string;
  studyGrade: string;
  endStudyGrade?: string;
  startBlock: string;
  endBlock: string;
  startDate: string;
  endDate: string;
  textbook: string | null;
  track?: MathLearningTrack;
  /** Absent only on goals saved before the 24-block semester plan. */
  blockCount?: number | null;
  milestones?: LearningMilestone[];
  updatedAt?: string;
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
};

export function standardGoalDates(month: string, track: MathLearningTrack, blocks: number = MATH_LEARNING_CADENCE[track].totalBlocks) {
  return {
    startDate: `${month}-01`,
    endDate: monthRange(shiftMonth(month, Math.max(1, blocks / MATH_LEARNING_CADENCE[track].monthlyBlocks) - 1)).to,
  };
}

/** One course interval is divided into teaching blocks without changing the source curriculum. */
export function goalMilestones(goal: LearningGoal): LearningMilestone[] {
  return goal.milestones?.length ? goal.milestones : [{ studyGrade: goal.endStudyGrade ?? goal.studyGrade, endBlock: goal.endBlock, endDate: goal.endDate, blockCount: goal.blockCount ?? goalBlocks(goal).length }];
}

/** Extending keeps every previous stop and its allocation; only the new tail is planned. */
export function planLearningGoal(draft: LearningGoal, previous?: LearningGoal): LearningGoal {
  const track = draft.track ?? "regular";
  const goal = previous ? { ...draft, studyGrade: previous.studyGrade, startBlock: previous.startBlock, startDate: previous.startDate, updatedAt: previous.updatedAt } : draft;
  const nextStop = { studyGrade: goal.endStudyGrade ?? goal.studyGrade, endBlock: goal.endBlock, endDate: goal.endDate, blockCount: 0 };
  const topics = learningTopics({ ...goal, milestones: [...(previous ? goalMilestones(previous) : []), nextStop] });
  const oldEnd = previous ? topics.findIndex((topic) => topic.grade === (previous.endStudyGrade ?? previous.studyGrade) && topic.lesson === previous.endBlock) : -1;
  const added = track === "supplement" ? 4 : topicSegments(topics.slice(oldEnd + 1)).length * 24;
  const count = (previous?.blockCount ?? (previous ? goalBlocks(previous).length : 0)) + added;
  const dates = standardGoalDates(goal.startDate.slice(0, 7), track, count);
  return {
    ...goal, ...dates, blockCount: count,
    milestones: [...(previous ? goalMilestones(previous) : []), { studyGrade: goal.endStudyGrade ?? goal.studyGrade, endBlock: goal.endBlock, endDate: dates.endDate, blockCount: count }],
  };
}

function allocatedSegments(goal: LearningGoal): { topics: LearningTopic[]; blocks: number; offset: number }[] {
  const topics = learningTopics(goal);
  if (!topics.length) return [];
  if (!goal.blockCount) return [{ topics, blocks: topics.length, offset: 0 }];
  if (goal.track === "supplement") return [{ topics, blocks: goal.blockCount, offset: 0 }];
  const result: { topics: LearningTopic[]; blocks: number; offset: number }[] = [];
  let from = 0, offset = 0;
  for (const milestone of goalMilestones(goal)) {
    const to = topics.findIndex((topic, index) => index >= from && topic.grade === milestone.studyGrade && topic.lesson === milestone.endBlock);
    if (to < from) return [];
    const segments = topicSegments(topics.slice(from, to + 1));
    const blocks = (milestone.blockCount - offset) / segments.length;
    for (const segment of segments) {
      result.push({ topics: segment, blocks, offset });
      offset += blocks;
    }
    from = to + 1;
  }
  return result;
}

export function learningBlocks(goal: LearningGoal): string[] {
  const crossCourse = goal.studyGrade !== (goal.endStudyGrade ?? goal.studyGrade);
  return allocatedSegments(goal).flatMap(({ topics, blocks }) => Array.from({ length: blocks }, (_, index) => {
    const from = Math.floor(topics.length * index / blocks);
    const to = Math.max(from, Math.ceil(topics.length * (index + 1) / blocks) - 1);
    const label = (topic: LearningTopic) => crossCourse ? `${topic.grade} · ${topic.lesson}` : topic.lesson;
    return from === to ? label(topics[from]) : `${label(topics[from])} ~ ${label(topics[to])}`;
  }));
}

export function validPlanDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function goalBlocks(
  goal: Pick<LearningGoal, "studyGrade" | "endStudyGrade" | "startBlock" | "endBlock">,
): string[] {
  return learningTopics(goal).map((topic) => topic.lesson);
}

export function learningGoalError(goal: LearningGoal): string | null {
  if (!validPlanDate(goal.startDate) || !validPlanDate(goal.endDate))
    return "시작일과 완료 예정일을 확인해 주세요.";
  if (goal.startDate > goal.endDate)
    return "완료 예정일은 시작일 이후로 정해 주세요.";
  if (goal.endDate > addDays(goal.startDate, goal.blockCount ? 3653 : 730))
    return `전체 목표 기간은 ${goal.blockCount ? "10" : "2"}년 이내로 설정해 주세요.`;
  if (!goalBlocks(goal).length)
    return "시작 단원보다 뒤에 있는 최종 목표 과정·단원을 선택해 주세요.";
  if ((goal.textbook?.length ?? 0) > 500)
    return "교재 이름은 500자 이내로 입력해 주세요.";
  if (goal.blockCount != null) {
    const track = goal.track ?? "regular";
    const policy = MATH_LEARNING_CADENCE[track];
    if (!Number.isInteger(goal.blockCount) || goal.blockCount <= 0 || goal.blockCount > policy.monthlyBlocks * 120)
      return "전체 목표는 10년 이내의 블록 수로 설정해 주세요.";
    const milestones = goalMilestones(goal);
    if (milestones.length > 100) return "목표 정거장은 100개 이내로 설정해 주세요.";
    const last = milestones.at(-1)!;
    if (last.studyGrade !== (goal.endStudyGrade ?? goal.studyGrade) || last.endBlock !== goal.endBlock || last.endDate !== goal.endDate || last.blockCount !== goal.blockCount)
      return "마지막 정거장과 최종 목표가 일치해야 합니다.";
    let previousCount = 0, previousDate = goal.startDate;
    for (const milestone of milestones) {
      if (!Number.isInteger(milestone.blockCount) || milestone.blockCount <= previousCount || !validPlanDate(milestone.endDate) || milestone.endDate <= previousDate)
        return "목표 정거장의 순서와 완료일을 확인해 주세요.";
      const dates = standardGoalDates(goal.startDate.slice(0, 7), track, milestone.blockCount);
      if (milestone.blockCount % policy.monthlyBlocks || goal.startDate !== dates.startDate || milestone.endDate !== dates.endDate)
        return "목표 기간과 월별 블록 수를 확인해 주세요.";
      previousCount = milestone.blockCount;
      previousDate = milestone.endDate;
    }
    if (track === "regular" && (!allocatedSegments(goal).length || allocatedSegments(goal).some((segment) => segment.blocks !== 24)))
      return "정규 목표는 학기별 24블록·3개월로 배분해 주세요.";
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
  const blocks = learningBlocks(goal);
  if (goal.blockCount != null) {
    const policy = MATH_LEARNING_CADENCE[goal.track ?? "regular"];
    const groups = Array.from({ length: goal.blockCount / policy.monthlyBlocks }, (_, index) => {
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
  const course = learningTopics(goal);
  const segments = allocatedSegments(goal);
  let current: number | null = null,
    currentBlock: string | null = null,
    currentDate: string | null = null;
  const reviewDates = new Set<string>();
  const plannedDates = new Set(days.map((day) => day.date));
  // Latest position wins, including a return to earlier blocks for revision. Future reports never count.
  for (const record of [...records].sort((a, b) =>
    a.date.localeCompare(b.date),
  )) {
    if (record.date < goal.startDate || record.date > referenceDate) continue;
    if (goal.track === "supplement") {
      if (record.date > goal.endDate || !plannedDates.has(record.date) || !record.progress?.trim()) continue;
      reviewDates.add(record.date);
      current = Math.min(total, reviewDates.size);
      currentBlock = record.progress.trim();
      currentDate = record.date;
      continue;
    }
    const index = learningTopicIndex(record.progress, course);
    if (index == null) {
      // Preserve the legacy same-course behavior for records outside a selected interval.
      if (goal.studyGrade !== (goal.endStudyGrade ?? goal.studyGrade)) continue;
      const before = recordBlockIndex(record.progress, goal.studyGrade);
      if (before == null) continue;
      const full = flatLessons(goal.studyGrade);
      current = before < full.indexOf(goal.startBlock) ? 0 : total;
      currentBlock = full[before]; currentDate = record.date;
      continue;
    }
    const topic = course[index];
    const segment = segments.find((s) => s.topics.some((t) => t.grade === topic.grade && t.lesson === topic.lesson));
    if (!segment) continue;
    const local = segment.topics.findIndex((t) => t.grade === topic.grade && t.lesson === topic.lesson);
    const position = segment.offset + (local + 1) / segment.topics.length * segment.blocks;
    current = Math.round(Math.max(0, Math.min(total, position)) * 10) / 10;
    currentBlock = goal.studyGrade === (goal.endStudyGrade ?? goal.studyGrade) ? topic.lesson : `${topic.grade} · ${topic.lesson}`;
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
