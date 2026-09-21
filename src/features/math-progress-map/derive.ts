/**
 * 진도맵 **뷰 트리** — 하루 기록 하나의 배열을 일 → 주 → 월 → 분기 → 연으로 접는다(순수, Vitest).
 *
 * 🔑 모든 단위가 **같은 쪽수**를 센다. 주의 계획 쪽 = 그 주 날들의 계획 쪽 합, 달 = 주들의 합, 분기·연 = 달들의 합.
 *    그래서 보기 단위를 바꿔도 같은 숫자가 확대/축소될 뿐이다(단위마다 다른 것을 세면 "월간 46%·주간 75%"가 서로
 *    무관한 숫자가 된다).
 * ⚠️ 기록이 한 건도 없는 달은 연간 계획(`MonthPlan`)의 쪽 범위를 계획 쪽으로 쓴다(그래야 미래 달의 칸이 비지 않는다).
 * 초점(고른 달·주·날) 위의 조회는 [`focus.ts`](./focus.ts).
 */
import { monthsOfQuarter, quarterOf, weeksOfMonth } from "./calendar";
import type { DailyProgress, MonthPlan, ProgressCalendar, StudentProgress } from "./model";
import { daySchedule } from "./day-schedule";
import { displayStatusOf, type DisplayStatus } from "./palette";
import { courseEndMonth, isAfterCourseEnd } from "./course-end";
import { courseStartDate, isBeforeCourseStart } from "./course-start";

export type DayView = {
  /** 첫 등원 이전 또는 종강 이후. 날짜 표식·수업 칸·선택을 만들지 않는다. */
  inactive: boolean;
  date: string;
  record: DailyProgress | null;
  status: DisplayStatus;
  plannedPages: number;
  donePages: number;
  isToday: boolean;
  /** 활성 기간의 공휴일명. 비활성 기간은 null이며 실제 수업·완료 기록은 그대로 유지한다. */
  holidayName: string | null;
  /** 정기 비수업일 또는 휴강 사유. 기록이 없다는 이유만으로 채우지 않는다. */
  noClassReason: string | null;
  isClassDay: boolean | null;
};

export type WeekView = {
  inactive: boolean;
  index: number;
  start: string;
  end: string;
  days: DayView[];
  plannedPages: number;
  donePages: number;
  pct: number;
  status: DisplayStatus;
  /** 그 주의 대표 소단원(계획 쪽이 있는 기록 중 가장 많이 나온 것). */
  topic: string | null;
  /** 계획 쪽 범위(첫 기록 시작 ~ 마지막 기록 끝). 없으면 null. */
  pageFrom: number | null;
  pageTo: number | null;
  isCurrent: boolean;
};

export type MonthView = {
  month: number;
  quarter: 1 | 2 | 3 | 4;
  plan: MonthPlan | null;
  weeks: WeekView[];
  plannedPages: number;
  donePages: number;
  pct: number;
  status: DisplayStatus;
  isCurrent: boolean;
  isPast: boolean;
  /** 종강(로드맵 마지막 끝 달) **뒤**인가 — 시계가 칸은 그리되 누르지 못하게 한다(원장 2026-09-16). */
  afterEnd: boolean;
  beforeStart: boolean;
  /** 기록의 계획 쪽 범위(첫 기록 시작 ~ 마지막 기록 끝). 기록이 없으면 연간 계획 범위. 둘 다 없으면 null. */
  pageFrom: number | null;
  pageTo: number | null;
};

/** `afterEnd`는 **석 달이 모두** 종강 뒤일 때만 true — 종강이 낀 분기는 살아 있다. */
export type QuarterView = { q: 1 | 2 | 3 | 4; months: MonthView[]; plannedPages: number; donePages: number; pct: number; afterEnd: boolean; beforeStart: boolean };

export type YearView = {
  year: number;
  asOf: string;
  months: MonthView[];
  quarters: QuarterView[];
  plannedPages: number;
  donePages: number;
  pct: number;
};

export function pctOf(done: number, planned: number): number {
  if (planned <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / planned) * 100)));
}

export function plannedPagesOf(r: Pick<DailyProgress, "startPage" | "endPage" | "lessons">): number {
  if (r.lessons) return r.lessons.positions.length;
  return r.startPage > 0 && r.endPage >= r.startPage ? r.endPage - r.startPage + 1 : 0;
}

export function donePagesOf(r: Pick<DailyProgress, "startPage" | "endPage" | "completedPage" | "lessons">): number {
  if (r.lessons) return r.lessons.done;
  const planned = plannedPagesOf(r);
  if (planned === 0) return 0;
  return Math.max(0, Math.min(planned, r.completedPage - r.startPage + 1));
}

/** 묶음(주·달) 상태 — 지난 묶음은 완료/부분/미학습, 지금 묶음은 완료/진행 중, 앞 묶음은 예정. */
function groupStatus(planned: number, done: number, isPast: boolean, isCurrent: boolean): DisplayStatus {
  if (planned === 0) return "no-plan";
  if (done >= planned) return "completed";
  if (isCurrent) return "in-progress";
  if (isPast) return done > 0 ? "in-progress" : "missed";
  return "planned";
}

function topicOf(days: DayView[]): string | null {
  const count = new Map<string, number>();
  for (const d of days) {
    if (!d.record || d.plannedPages === 0) continue;
    count.set(d.record.subChapter, (count.get(d.record.subChapter) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of count) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

function buildWeek(w: { index: number; start: string; end: string; days: string[] }, byDate: Map<string, DailyProgress>, asOf: string, calendar: ProgressCalendar | undefined, startDate: string | null): WeekView {
  const days: DayView[] = w.days.map((date) => {
    const record = byDate.get(date) ?? null;
    const schedule = daySchedule(date, record, calendar);
    const inactive = startDate != null && date < startDate;
    return {
      inactive,
      date,
      record,
      status: record?.lessons && !record.lessons.known && record.lessons.positions.length ? "unknown"
        : !record && schedule.isClassDay && date > asOf ? "planned" : displayStatusOf(record?.status ?? null, date, asOf),
      plannedPages: record ? plannedPagesOf(record) : 0,
      donePages: record ? donePagesOf(record) : 0,
      isToday: !inactive && date === asOf,
      ...schedule,
      ...(inactive ? { holidayName: null, noClassReason: "첫 등원 이전", isClassDay: false } : {}),
    };
  });
  const plannedPages = days.reduce((s, d) => s + d.plannedPages, 0);
  const donePages = days.reduce((s, d) => s + d.donePages, 0);
  const isCurrent = w.start <= asOf && asOf <= w.end;
  const paged = days.filter((d) => d.plannedPages > 0);
  return {
    inactive: days.every(day => day.inactive),
    index: w.index,
    start: w.start,
    end: w.end,
    days,
    plannedPages,
    donePages,
    pct: pctOf(donePages, plannedPages),
    status: days.some(day => day.status === "unknown") ? "unknown" : groupStatus(plannedPages, donePages, w.end < asOf, isCurrent),
    topic: topicOf(days),
    pageFrom: paged[0]?.record?.startPage ?? null,
    pageTo: paged[paged.length - 1]?.record?.endPage ?? null,
    isCurrent,
  };
}

export function buildYearView(p: StudentProgress): YearView {
  const byDate = new Map(p.dailyProgress.map((r) => [r.date, r] as const));
  const planByMonth = new Map(p.yearPlan.map((m) => [m.month, m] as const));
  const endMonth = courseEndMonth(p);
  const startDate = courseStartDate(p);
  const asOfMonth = Number(p.asOf.slice(5, 7));
  const asOfYear = Number(p.asOf.slice(0, 4));

  const months: MonthView[] = [];
  for (let m = 1; m <= 12; m++) {
    const weeks = weeksOfMonth(p.year, m).map((w) => buildWeek(w, byDate, p.asOf, p.calendar, startDate));
    const plan = planByMonth.get(m) ?? null;
    const recorded = weeks.reduce((s, w) => s + w.plannedPages, 0);
    // 🔴 "기록이 있다" = **계획 쪽이 있는 기록** — 휴강 행(0쪽)만 있는 달이 연간 계획을 버리고 0%로 떨어지지 않게.
    const hasPaged = recorded > 0;
    const plannedPages = p.learningMap || hasPaged || !plan ? recorded : plan.endPage - plan.startPage + 1;
    const donePages = weeks.reduce((s, w) => s + w.donePages, 0);
    const paged = weeks.filter((w) => w.pageFrom != null);
    const pageFrom = hasPaged ? (paged[0]?.pageFrom ?? null) : (plan?.startPage ?? null);
    const pageTo = hasPaged ? (paged[paged.length - 1]?.pageTo ?? null) : (plan?.endPage ?? null);
    const isCurrent = p.year === asOfYear && m === asOfMonth;
    const isPast = p.year < asOfYear || (p.year === asOfYear && m < asOfMonth);
    const afterEnd = isAfterCourseEnd(endMonth, p.year, m) && plannedPages === 0 && donePages === 0 && !(p.learningMap && weeks.some(week => week.days.some(day => day.record)));
    // 종강 이후에도 공휴일·오늘 표식이나 정기 수업 칸이 남지 않게 한다. 실제 기록이 있는 달은 위에서 살린다.
    if (afterEnd) for (const week of weeks) {
      week.inactive = true;
      week.isCurrent = false;
      week.days = week.days.map(day => ({ ...day, inactive: true, holidayName: null, noClassReason: "종강 이후", isClassDay: false, isToday: false }));
    }
    months.push({
      month: m,
      quarter: quarterOf(m),
      plan,
      weeks,
      plannedPages,
      donePages,
      pct: pctOf(donePages, plannedPages),
      status: weeks.some(week => week.status === "unknown") ? "unknown" : groupStatus(plannedPages, donePages, isPast, isCurrent),
      isCurrent,
      isPast,
      // 🔴 **로드맵 한 축으로 막지 않는다** — 로드맵이 낡아 종강 뒤에도 기록이 쌓이면(실데이터에선 흔하다)
      //    그 달이 옅어지고 클릭까지 막혀 **기록이 있는데 못 여는** 달이 된다(적대 리뷰 2026-09-16).
      //    원장이 가리킨 화면(진도율 자리에 `—`만 남은 달)과 정확히 같은 집합으로 좁힌다.
      afterEnd,
      beforeStart: isBeforeCourseStart(startDate, p.year, m),
      pageFrom,
      pageTo,
    });
  }

  const quarters: QuarterView[] = ([1, 2, 3, 4] as const).map((q) => {
    const qm = monthsOfQuarter(q).map((m) => months[m - 1]!);
    const plannedPages = qm.reduce((s, x) => s + x.plannedPages, 0);
    const donePages = qm.reduce((s, x) => s + x.donePages, 0);
    return { q, months: qm, plannedPages, donePages, pct: pctOf(donePages, plannedPages), afterEnd: qm.every((x) => x.afterEnd), beforeStart: qm.every(x => x.beforeStart) };
  });
  const plannedPages = months.reduce((s, x) => s + x.plannedPages, 0);
  const donePages = months.reduce((s, x) => s + x.donePages, 0);
  return { year: p.year, asOf: p.asOf, months, quarters, plannedPages, donePages, pct: pctOf(donePages, plannedPages) };
}
