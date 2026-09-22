import type { WeekView } from "./derive";
import { dayAngles, dayRingAngles, midAngle } from "./geometry";

/** 일정 또는 실제 기록으로 확인된 수업만 표시한다. 휴강·일정 미확인은 빈 요일 칸을 만들지 않는다. */
export function classDaysOfWeek(week: WeekView) {
  return week.days.filter(day => !day.inactive && day.isClassDay === true && !day.noClassReason && day.record?.status !== "no-plan");
}

/** 월·주 경계는 고정하고, 해당 주 안의 실제 수업만 같은 폭으로 배치한다. */
export function weekSessionLayout(week: WeekView) {
  const days = classDaysOfWeek(week);
  const start = dayAngles(week.days.find(day => !day.inactive)?.date ?? week.start)[0];
  const end = dayAngles(week.days.findLast(day => !day.inactive)?.date ?? week.end)[1];
  return days.map((day, index) => ({
    day,
    angles: [start + (end - start) * index / days.length, start + (end - start) * (index + 1) / days.length] as [number, number],
  }));
}

/** 선택한 수업은 바깥 눈금과 정렬한다. 비수업일을 조회 중이면 가까운 다음 수업(없으면 마지막)에 맞춘다. */
export function daySessionLayout(week: WeekView, referenceDate: string) {
  const sessions = weekSessionLayout(week);
  if (!sessions.length) return [];
  const next = sessions.findIndex(({ day }) => day.date >= referenceDate);
  const anchor = next < 0 ? sessions.length - 1 : next;
  const cells = dayRingAngles(midAngle(sessions[anchor].angles), sessions.length, anchor);
  return sessions.map((session, index) => ({ ...session, tickAngles: session.angles, angles: cells[index] }));
}
