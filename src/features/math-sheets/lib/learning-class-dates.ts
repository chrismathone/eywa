import { shiftMonth } from "@/lib/date-kst";
import { dowKeyOf } from "@/features/class-sheets/lib/week";
import { classDaysOf } from "./class-days";
import type { LearningContext } from "./learning-plan";

/** 시간표 유효기간·학생 등원요일·수강기간·학원 휴원일을 적용한 실제 수업 예정일. */
export function learningClassDates(studentId: string, context: LearningContext, from: string, to: string): string[] {
  const spans = context.spans[studentId] ?? [];
  const dates: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = shiftMonth(month, 1)) {
    for (const { date } of classDaysOf(month, context.schedules)) {
      if (date < from || date > to || context.holidays[date]) continue;
      if (spans.some(span => span.start <= date && (span.end == null || date <= span.end)
        && (!span.attendanceDays?.length || span.attendanceDays.includes(dowKeyOf(date))))) dates.push(date);
    }
  }
  return dates;
}
