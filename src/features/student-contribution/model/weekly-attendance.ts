import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isAttendedStatus } from "@/lib/calc/attendance";
import { addDays } from "@/lib/date-kst";
import type { AttendanceTarget, ContributionAttendance } from "./participation";

const targetKey = (r: AttendanceTarget) => `${r.class_id}\0${r.session_date}\0${r.slot_start ?? ""}`;
const dayKey = (r: { class_id: string; session_date: string }) => `${r.class_id}\0${r.session_date}`;
export function weekOf(day: string) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  const from = addDays(day, -((weekday + 6) % 7));
  return { from, through: addDays(from, 6) };
}

/** One student × completed Mon–Sun week, credited to Sunday's month. All scheduled classes/slots must match. */
export function completedAttendanceWeeks(input: { studentId: string; month: string; today: string; allowLate: boolean;
  targets: readonly AttendanceTarget[]; attendance: readonly ContributionAttendance[] }) {
  const weeks = new Map<string, { from: string; through: string; targets: AttendanceTarget[] }>();
  const unique = new Map(input.targets.filter(t => t.student_id === input.studentId).map(t => [targetKey(t), t]));
  for (const target of unique.values()) {
    const week = weekOf(target.session_date);
    // Coverage begins in 2026. A partial first week cannot prove attendance in December.
    if (week.from < "2026-01-01" || week.through >= input.today || !week.through.startsWith(input.month)) continue;
    const group = weeks.get(week.from) ?? { ...week, targets: [] };
    group.targets.push(target); weeks.set(week.from, group);
  }
  const byDay = new Map<string, ContributionAttendance[]>();
  const effective = effectiveAttendanceRecords(input.attendance.filter(r => r.student_id === input.studentId)).filter(r => !r.seat_label);
  for (const record of effective) {
    const key = dayKey(record), rows = byDay.get(key) ?? [];
    rows.push(record); byDay.set(key, rows);
  }
  return [...weeks.values()].flatMap(week => {
    const matched = week.targets.map(target => {
      const rows = byDay.get(dayKey(target)) ?? [];
      return target.slot_start && rows.some(r => r.slot_start) ? rows.filter(r => r.slot_start === target.slot_start) : rows;
    });
    if (!matched.every(rows => rows.length && rows.every(r => isAttendedStatus(r.status) && (input.allowLate || r.status !== "late")))) return [];
    return [{ from: week.from, through: week.through, evidenceIds: [...new Set(matched.flatMap(rows => rows.map(r => `attendance:${r.id}`)))] }];
  });
}
