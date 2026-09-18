import { flatLessons, splitLessons } from "@/features/onescreen/curriculum";
import { MATH_LEARNING_CADENCE, type MathLearningTrack } from "@/features/progress/learning-cadence";
import { addDays, monthRange, shiftMonth } from "@/lib/date-kst";
import { type MathScheduleRow } from "./class-days";
import { learningClassDates } from "./learning-class-dates";
import type { EnrollSpan } from "@/features/attendance/enrollment-span";
import { learningTopics, learningTopicIndex, learningTimelineTopics, learningTimelineTopicIndex, topicSegments, type LearningMilestone, type LearningTopic } from "./learning-path";

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
  /** Absent only on goals saved before standard semester plans. */
  blockCount?: number | null;
  milestones?: LearningMilestone[];
  updatedAt?: string;
};
export type LearningRecord = {
  date: string;
  progress: string | null;
  textbook: string | null;
  homework?: string | null;
  sentAt?: string | null;
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
export type LearningHistory = {
  enrolledAt: string | null;
  fromDate: string;
  start: { grade: string; lesson: string } | null;
  lessons: { grade: string; lesson: string; date: string; estimated: boolean }[];
};
export type LearningProgress = {
  referenceDate?: string;
  history?: LearningHistory;
  total: number;
  current: number | null;
  currentBlock: string | null;
  currentDate: string | null;
  /** Latest sent report; its free text may differ from the last identifiable curriculum unit. */
  latestRecord?: LearningRecord | null;
  currentIsLatest?: boolean;
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

/** Read old 24-block plans in the current unit, preserving dates and optimistic-lock tokens. */
export function normalizeLearningGoal(goal: LearningGoal): LearningGoal {
  if (goal.track === "supplement" || !goal.blockCount || goal.blockCount % 24 !== 0) return goal;
  const legacyEnd = monthRange(shiftMonth(goal.startDate.slice(0, 7), goal.blockCount / 8 - 1)).to;
  if (goal.endDate !== legacyEnd) return goal;
  const stops = goalMilestones(goal);
  if (stops.some((stop) => !Number.isInteger(stop.blockCount / 2))) return goal;
  return { ...goal, blockCount: goal.blockCount / 2,
    milestones: stops.map((stop) => ({ ...stop, blockCount: stop.blockCount / 2 })) };
}

/** Extending keeps every previous stop and its allocation; only the new tail is planned. */
export function planLearningGoal(draft: LearningGoal, previous?: LearningGoal): LearningGoal {
  if (previous) previous = normalizeLearningGoal(previous);
  const track = draft.track ?? "regular";
  const goal = previous ? { ...draft, studyGrade: previous.studyGrade, startBlock: previous.startBlock, startDate: previous.startDate, updatedAt: previous.updatedAt } : draft;
  const nextStop = { studyGrade: goal.endStudyGrade ?? goal.studyGrade, endBlock: goal.endBlock, endDate: goal.endDate, blockCount: 0 };
  const topics = learningTopics({ ...goal, milestones: [...(previous ? goalMilestones(previous) : []), nextStop] });
  const oldEnd = previous ? topics.findIndex((topic) => topic.grade === (previous.endStudyGrade ?? previous.studyGrade) && topic.lesson === previous.endBlock) : -1;
  const added = track === "supplement" ? MATH_LEARNING_CADENCE.supplement.totalBlocks : topicSegments(topics.slice(oldEnd + 1)).length * MATH_LEARNING_CADENCE.regular.totalBlocks;
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
  const result: { topics: LearningTopic[]; blocks: number; offset: number }[] = [];
  let from = 0, offset = 0;
  for (const milestone of goalMilestones(goal)) {
    const to = topics.findIndex((topic, index) => index >= from && topic.grade === milestone.studyGrade && topic.lesson === milestone.endBlock);
    if (to < from) return [];
    if (goal.track === "supplement") {
      result.push({ topics: topics.slice(from, to + 1), blocks: milestone.blockCount - offset, offset });
      offset = milestone.blockCount;
      from = to + 1;
      continue;
    }
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

/** Preserve every curriculum endpoint; rounding here would merge distinct lessons. */
export function learningTopicPositions(goal: LearningGoal): (LearningTopic & { block: number })[] {
  return allocatedSegments(goal).flatMap(({ topics, blocks, offset }) => topics.map((topic, index) => ({
    ...topic,
    block: offset + (index + 1) / topics.length * blocks,
  })));
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
    if (track === "regular" && (!allocatedSegments(goal).length || allocatedSegments(goal).some((segment) => segment.blocks !== policy.totalBlocks)))
      return `정규 목표는 학기별 ${policy.totalBlocks}블록·${policy.months}개월로 배분해 주세요.`;
  }
  return null;
}

export function learningDays(
  goal: LearningGoal,
  context: LearningContext,
): PlannedDay[] {
  if (learningGoalError(goal)) return [];
  const dates = learningClassDates(goal.studentId, context, goal.startDate, goal.endDate);
  const blocks = learningBlocks(goal);
  if (goal.blockCount != null) {
    const policy = MATH_LEARNING_CADENCE[goal.track ?? "regular"];
    const groups = Array.from({ length: goal.blockCount / policy.monthlyBlocks }, (_, index) => {
      const month = shiftMonth(goal.startDate.slice(0, 7), index);
      return dates.filter((date) => date.startsWith(month));
    });
    // A missing month cannot silently count as completed teaching blocks.
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
  const course = learningTopicPositions(goal);
  const timeline = learningTimelineTopics(goal);
  let current: number | null = null,
    currentBlock: string | null = null,
    currentDate: string | null = null;
  let latestRecord: LearningRecord | null = null;
  let currentRecord: LearningRecord | null = null;
  const reviewDates = new Set<string>();
  const plannedDates = new Set(days.map((day) => day.date));
  // Latest position wins, including a return to earlier blocks for revision. Future reports never count.
  for (const record of [...records].sort((a, b) =>
    a.date.localeCompare(b.date) || (a.sentAt ?? "").localeCompare(b.sentAt ?? ""),
  )) {
    if (record.date > referenceDate) continue;
    if (goal.track === "supplement" && record.date > goal.endDate) continue;
    latestRecord = record;
    if (goal.track === "supplement") {
      if (record.date >= goal.startDate && plannedDates.has(record.date) && record.progress?.trim()) {
        reviewDates.add(record.date);
        current = Math.min(total, reviewDates.size);
      }
      const index = learningTimelineTopicIndex(record.progress, goal, timeline);
      if (index != null) {
        const topic = timeline[index];
        currentBlock = topic.grade === goal.studyGrade && goal.studyGrade === (goal.endStudyGrade ?? goal.studyGrade) ? topic.lesson : `${topic.grade} · ${topic.lesson}`;
        currentDate = record.date;
        currentRecord = record;
      }
      continue;
    }
    const index = learningTopicIndex(record.progress, course);
    if (index == null) {
      // The displayed history can precede a saved goal, including goals spanning several grades.
      const before = learningTimelineTopicIndex(record.progress, goal, timeline);
      if (before == null) continue;
      const start = timeline.findIndex(topic => topic.grade === goal.studyGrade && topic.lesson === goal.startBlock);
      current = before < start ? 0 : total;
      const topic = timeline[before];
      currentBlock = topic.grade === goal.studyGrade && goal.studyGrade === (goal.endStudyGrade ?? goal.studyGrade) ? topic.lesson : `${topic.grade} · ${topic.lesson}`;
      currentDate = record.date;
      currentRecord = record;
      continue;
    }
    const topic = course[index];
    current = Math.max(0, Math.min(total, Math.round(topic.block * 10) / 10));
    currentBlock = goal.studyGrade === (goal.endStudyGrade ?? goal.studyGrade) ? topic.lesson : `${topic.grade} · ${topic.lesson}`;
    currentDate = record.date;
    currentRecord = record;
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
    referenceDate,
    total,
    current,
    currentBlock,
    currentDate,
    latestRecord,
    currentIsLatest: currentRecord != null && currentRecord === latestRecord,
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
  progress: Pick<LearningProgress, "status" | "difference"> | undefined,
  unit = "블록",
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
      return `${Math.abs(progress.difference ?? 0)}${unit} 느림`;
    case "ahead":
      return `${progress.difference}${unit} 빠름`;
    default:
      return "계획대로";
  }
}
