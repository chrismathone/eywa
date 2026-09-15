import { holidayFor } from "@/features/calendar/holidays";
import { weekdayOf } from "./calendar";
import type { DayView } from "./derive";
import type { DailyProgress, ProgressCalendar } from "./model";
import { STATUS_LABEL } from "./palette";

/** 공휴일 표는 색·이름만 제공한다. 휴강 여부와 쪽수는 학생 일정·학습 기록으로 판단한다. */
export function daySchedule(date: string, record: DailyProgress | null, calendar?: ProgressCalendar) {
  const holidayName = holidayFor(date);
  // 보강·시험·오답정리 등 실제 수업이 있으면 정기 비수업요일이어도 수업으로 보여준다.
  if (record && record.status !== "no-plan") return { holidayName, noClassReason: null };
  const closure = calendar?.daysOff?.[date];
  const regularOff = calendar?.classWeekdays != null && !calendar.classWeekdays.includes(weekdayOf(date));
  return { holidayName, noClassReason: closure ?? (regularOff ? "정기 수업 없는 요일" : null) };
}

export function dayStatusLabel(day: DayView): string {
  return day.noClassReason ? "수업 없음" : STATUS_LABEL[day.status];
}

/** 요일·날짜 이름 뒤에 붙일 접근성 설명. 색을 보지 않아도 공휴일과 비수업일을 구분한다. */
export function dayDescription(day: DayView): string {
  return [day.holidayName, dayStatusLabel(day)].filter(Boolean).join(" · ");
}
