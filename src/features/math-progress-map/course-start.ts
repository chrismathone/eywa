import { daysInMonth, ymd } from "./calendar";
import type { StudentProgress } from "./model";

/** MCS의 학생 등록일. 최근 보고서나 교재 목표 시작일을 첫 등원일로 추정하지 않는다. */
export function courseStartDate(progress: Pick<StudentProgress, "roadmap">): string | null {
  const date = progress.roadmap?.enrolledOn;
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

export function isBeforeCourseStart(start: string | null, year: number, month: number): boolean {
  return start != null && ymd(year, month, daysInMonth(year, month)) < start;
}
