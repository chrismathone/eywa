import { rosterIncludesEnrollment } from "@/features/onescreen/roster-filter";
import { isVideoHomeworkDate } from "./types";

export type LedgerClass = { id: string; class_name: string; subject: string; is_active: boolean; closed_at: string | null };
export type LedgerEnrollment = {
  class_id: string; student_id: string; start_date: string | null; end_date: string | null;
  on_hold: boolean | null; is_transferred: boolean | null; attendance_days: string[] | null;
};
export type LedgerSchedule = { class_id: string; day_of_week: string; valid_from: string | null; valid_to: string | null };
export type LedgerOccurrence = { class_id: string; student_id: string; date: string };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function isVideoHomeworkRange(from: string, to: string): boolean {
  return isVideoHomeworkDate(from) && isVideoHomeworkDate(to) && from <= to &&
    (Date.parse(to) - Date.parse(from)) / 86_400_000 < 366;
}

/** 한 번의 기간 조회에서 명단을 만든다. 날짜별 DB 요청이나 기록이 있는 학생만의 집계를 피한다. */
export function buildVideoHomeworkLessonPairs(input: {
  classes: LedgerClass[]; enrollments: LedgerEnrollment[]; schedules: LedgerSchedule[];
  occurrences: LedgerOccurrence[]; fromDate: string; toDate: string; today: string;
}) {
  if (!isVideoHomeworkRange(input.fromDate, input.toDate)) throw new Error("조회 기간은 최대 366일입니다.");
  const classes = new Map(input.classes.map((row) => [row.id, row]));
  const schedules = new Map<string, LedgerSchedule[]>();
  for (const row of input.schedules) {
    const entries = schedules.get(row.day_of_week) ?? [];
    entries.push(row);
    schedules.set(row.day_of_week, entries);
  }
  const enrollments = new Map<string, LedgerEnrollment[]>();
  for (const row of input.enrollments) {
    const entries = enrollments.get(row.class_id) ?? [];
    entries.push(row);
    enrollments.set(row.class_id, entries);
  }
  const pairs = new Map<string, { classId: string; studentId: string; dates: Set<string> }>();
  function add(classId: string, studentId: string, date: string) {
    if (!classes.has(classId) || date < input.fromDate || date > input.toDate) return;
    const key = `${classId}:${studentId}`;
    const pair = pairs.get(key) ?? { classId, studentId, dates: new Set<string>() };
    pair.dates.add(date);
    pairs.set(key, pair);
  }
  for (let day = Date.parse(`${input.fromDate}T00:00:00Z`); day <= Date.parse(`${input.toDate}T00:00:00Z`); day += 86_400_000) {
    const date = new Date(day).toISOString().slice(0, 10);
    const weekday = DAYS[new Date(day).getUTCDay()];
    const scheduled = new Set<string>();
    for (const schedule of schedules.get(weekday) ?? []) {
      const cls = classes.get(schedule.class_id);
      if (!cls || (date >= input.today && !cls.is_active) || (cls.closed_at && date > cls.closed_at.slice(0, 10))) continue;
      if (schedule.valid_from && date < schedule.valid_from || schedule.valid_to && date > schedule.valid_to) continue;
      scheduled.add(cls.id);
    }
    for (const classId of scheduled) {
      for (const enrollment of enrollments.get(classId) ?? []) {
        if (rosterIncludesEnrollment(enrollment, date, weekday, true)) add(classId, enrollment.student_id, date);
      }
    }
  }
  // 출결·보강·검사 이력은 현재 수강 상태와 무관하게 남긴다.
  for (const row of input.occurrences) add(row.class_id, row.student_id, row.date);
  return [...pairs.values()].map(({ dates, ...pair }) => ({ ...pair, lessonDates: [...dates].sort() }));
}
