import { daysInMonth, weekdayOf, ymd } from "./calendar";
import type { DailyProgress, MonthPlan, RoadmapStep, StudentProgress } from "./model";

export function availableYears(progress: StudentProgress): number[] {
  return [...new Set([progress.year, ...(progress.years ?? []).map((p) => p.year)])].sort((a, b) => a - b);
}

/** 실제 기준일·현재 위치는 고정하고, 선택 연도의 기록과 계획만 바꾼다. */
export function progressForYear(progress: StudentProgress, year: number): StudentProgress {
  if (year === progress.year) return progress;
  const target = progress.years?.find((p) => p.year === year);
  return target ? { ...progress, ...target } : progress;
}

export function monthKey(year: number, month: number): string {
  return ymd(year, month, 1).slice(0, 7);
}

export function stepContains(step: RoadmapStep, year: number, month: number): boolean {
  const key = monthKey(year, month);
  return step.startMonth <= key && key <= step.endMonth;
}

export function formatYearMonth(month: string): string {
  return month.replace("-", ".");
}

/** 미래 월 계획을 평일에 배분한다. 완료 실적은 만들지 않고, 기준일 이전 달에는 적용하지 않는다. */
export function plannedDaysForMonth(year: number, plan: MonthPlan, asOf: string): DailyProgress[] {
  if (monthKey(year, plan.month) <= asOf.slice(0, 7)) return [];
  const days = Array.from({ length: daysInMonth(year, plan.month) }, (_, i) => ymd(year, plan.month, i + 1))
    .filter((date) => weekdayOf(date) >= 1 && weekdayOf(date) <= 5);
  const total = plan.startPage > 0 ? Math.max(0, plan.endPage - plan.startPage + 1) : 0;
  if (total === 0) return [];
  const base = Math.floor(total / days.length);
  const extra = total % days.length;
  let page = plan.startPage;
  return days.flatMap((date, i) => {
    const count = base + (i < extra ? 1 : 0);
    if (count === 0) return [];
    const startPage = page;
    page += count;
    return [{ date, bookName: plan.bookName, chapter: plan.chapter, subChapter: "",
      startPage, endPage: page - 1, completedPage: startPage - 1, status: "not-started" as const,
      note: "장기 계획을 평일에 배분한 예상 진도" }];
  });
}
