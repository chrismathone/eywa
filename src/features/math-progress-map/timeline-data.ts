import { daysInMonth, ymd } from "./calendar";
import { monthPosition } from "./continuous-timeline";
import type { DayView, MonthView, YearView } from "./derive";
import type { StudentProgress } from "./model";

export type TimelineStatus = "completed" | "current" | "future" | "no-plan";
export type CurriculumPeriod = {
  id: string;
  year: number;
  quarter: number;
  month: number;
  bookName: string;
  semester: string;
  chapter: string;
  subChapter: string;
  startDate: string;
  targetEndDate: string;
  progress: number;
  completedUnits: number;
  totalUnits: number;
  status: TimelineStatus;
  isActual: boolean;
  isPast: boolean;
  source: MonthView;
};

/** 달력상의 분기 대신 실제 등록된 과정으로 안내한다. */
export function quarterCurriculumLabel(periods: readonly CurriculumPeriod[]): string {
  const courses = [...new Set(periods.filter((period) => period.source.plan || period.source.plannedPages > 0)
    .map((period) => period.semester || period.bookName))];
  return courses.length ? `${courses.join(" → ")} 학습` : "학습 계획 미등록";
}

/**
 * 🔴 `completed.symbol`("✓")은 **화면에 안 쓴다** — 그리는 자리(`curriculum-timeline.tsx`)가 완료일 때만
 * `EyIcon name="check"`로 갈아탄다. 아이콘 가드(`eywa-icon-mapping.test.ts`)는 **`.tsx`만 읽어** 이 글자를
 * 못 본다 — 여기 값을 그대로 그리도록 되돌리면 raw ✓가 살아나는데 **가드는 초록이다**(같은 되돌림이
 * 2026-09-15·09-16 두 번 있었다). 이 상수를 손볼 땐 그 자리도 함께 볼 것.
 */
export const TIMELINE_STATUS = {
  completed: { label: "완료", symbol: "✓" },
  current: { label: "진행 중", symbol: "●" },
  future: { label: "예정", symbol: "○" },
  "no-plan": { label: "계획 없음", symbol: "—" },
} as const;

/** 기존 월별 계획과 일별 보고서를 접는다. UI용 진도율·단원 수를 별도로 만들어 넣지 않는다. */
export function curriculumPeriods(view: YearView, progress: StudentProgress): CurriculumPeriod[] {
  const actualYear = Number(progress.asOf.slice(0, 4));
  const actualMonth = Number(progress.asOf.slice(5, 7));
  return view.months.map((month) => {
    const days = month.weeks.flatMap((week) => week.days).filter((day) => day.record && day.plannedPages > 0);
    const units = new Map<string, { done: number; planned: number }>();
    for (const day of days) {
      const topic = day.record!.subChapter || day.record!.chapter;
      if (!topic) continue;
      const count = units.get(topic) ?? { done: 0, planned: 0 };
      units.set(topic, { done: count.done + day.donePages, planned: count.planned + day.plannedPages });
    }
    const first = days[0]?.record;
    const isActual = view.year === actualYear && month.month === actualMonth;
    const isPast = monthPosition(view.year, month.month) < monthPosition(actualYear, actualMonth);
    const status: TimelineStatus = month.plannedPages === 0 ? "no-plan" : isActual ? "current"
      : month.pct === 100 ? "completed" : isPast ? "current" : "future";
    return {
      id: `${view.year}-${String(month.month).padStart(2, "0")}`,
      year: view.year, quarter: month.quarter, month: month.month,
      bookName: month.plan?.bookName ?? first?.bookName ?? "교재 계획 없음",
      semester: month.plan?.semester ?? "",
      chapter: month.plan?.chapter ?? first?.chapter ?? "학습 계획이 없습니다",
      subChapter: [...units.keys()].join(" · "),
      startDate: ymd(view.year, month.month, 1), targetEndDate: ymd(view.year, month.month, daysInMonth(view.year, month.month)),
      progress: month.pct, completedUnits: [...units.values()].filter((unit) => unit.done >= unit.planned).length,
      totalUnits: units.size, status, isActual, isPast, source: month,
    };
  });
}

/** 실제 이번 주는 기준일로 찾는다. 과거를 탐색해도 실제 날짜가 바뀌지 않는다. */
export function detailDays(period: CurriculumPeriod, asOf: string): DayView[] {
  const weeks = period.source.weeks;
  const week = period.isActual ? weeks.find((item) => item.start <= asOf && item.end >= asOf) : weeks.find((item) => item.days.some((day) => day.record));
  return (week?.days ?? []).filter((day) => day.record || day.isToday);
}
