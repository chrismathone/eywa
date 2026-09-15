import type { StudentProgress } from "./model";
import { availableYears } from "./years";

/** 12월→1월도 차이가 1인 연속 월 좌표. */
export function monthPosition(year: number, month: number): number {
  return year * 12 + month - 1;
}

export function periodAt(position: number): { year: number; month: number } {
  const index = Math.round(position);
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

/** 선택한 달 앞 5개월과 뒤 6개월. 원의 반대편부터 다음 해의 달로 이어진다. */
export function rollingPeriods(position: number) {
  return Array.from({ length: 12 }, (_, index) => periodAt(position + index - 5)).sort((a, b) => a.month - b.month);
}

/** 12시 방향 경계를 지날 때도 드래그가 한 바퀴 튀지 않는다. */
export function turnDelta(previous: number, next: number): number {
  return ((next - previous + 540) % 360) - 180;
}

/** 입학·기록·계획에 있는 실제 월 범위. 자료가 없을 때만 조회 가능한 연도 전체를 쓴다. */
export function timelineRange(progress: StudentProgress): { min: number; max: number } {
  const years = availableYears(progress);
  const months = [progress, ...(progress.years ?? [])].flatMap((data) => [
    ...data.yearPlan.map((plan) => monthPosition(data.year, plan.month)),
    ...data.dailyProgress.map((day) => monthPosition(Number(day.date.slice(0, 4)), Number(day.date.slice(5, 7)))),
  ]);
  const dates = [
    ...(progress.roadmap ? [progress.roadmap.enrolledOn, ...progress.roadmap.steps.flatMap((step) => [step.startMonth, step.endMonth])] : []),
  ];
  months.push(...dates.map((date) => monthPosition(Number(date.slice(0, 4)), Number(date.slice(5, 7)))));
  const usable = months.filter((position) => Number.isFinite(position) && years.includes(periodAt(position).year));
  return usable.length > 0 ? { min: Math.min(...usable), max: Math.max(...usable) }
    : { min: monthPosition(years[0]!, 1), max: monthPosition(years.at(-1)!, 12) };
}

/** 양 끝은 실제 시작·종료 월, 중간 정거장은 각 연도의 1월 좌표다. */
export function timelineStops(min: number, max: number, years: readonly number[]) {
  const firstYear = periodAt(min).year;
  const lastYear = periodAt(max).year;
  const positions = [...new Set([min, ...years.filter((year) => year > firstYear && year < lastYear).map((year) => monthPosition(year, 1)), max])];
  return positions.map((position) => ({
    ...periodAt(position), position, offset: max === min ? 0 : (position - min) / (max - min) * 100,
  }));
}
