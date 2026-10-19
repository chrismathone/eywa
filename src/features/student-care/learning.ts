import { addDays } from "@/lib/date-kst";
import { parseHomeworkRate } from "@/features/onescreen/homework-rate";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { dayOf, uniqueRows } from "./dates";
import type { Attendance, Grade, Level, Report } from "./types";

export function homeworkOf(rows: readonly Report[], today: string) {
  const recentStart = addDays(today, -27), previousStart = addDays(today, -55);
  const subjects = new Map<string, { recent: number[]; previous: number[]; missing: number }>();
  for (const row of uniqueRows(rows)) {
    const date = dayOf(row.report_date);
    if (!date || date < previousStart || date > today) continue;
    const linkedClass = Array.isArray(row.class) ? (row.class.length === 1 ? row.class[0] : null) : row.class;
    // Never assign unclassified imports to an arbitrary subject in a support assessment.
    const subject = row.subject?.trim() || linkedClass?.subject?.trim() || "과목 미확인";
    const entry = subjects.get(subject) ?? { recent: [], previous: [], missing: 0 };
    const value = parseHomeworkRate(row.homework_score);
    if (value == null) entry.missing++;
    else (date >= recentStart ? entry.recent : entry.previous).push(value);
    subjects.set(subject, entry);
  }
  const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null;
  return [...subjects].map(([subject, row]) => {
    const recent = average(row.recent), previous = average(row.previous);
    const comparable = subject !== "과목 미확인" && row.recent.length >= 4 && row.previous.length >= 4;
    const delta = comparable ? Math.round((recent! - previous!) * 10) / 10 : null;
    return { subject, recent, previous, delta, comparable, recentCount: row.recent.length,
      previousCount: row.previous.length, missing: row.missing, flag: delta != null && delta <= -20 };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
}

const numeric = (v: unknown): number | null => {
  if (v == null || (typeof v === "string" && !v.trim()) || (typeof v !== "number" && typeof v !== "string")) return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
};
export function gradesOf(rows: readonly Grade[], today: string, enrolledAt: string | null) {
  const entry = dayOf(enrolledAt);
  const groups = new Map<string, Grade[]>();
  for (const row of uniqueRows(rows).sort((a, b) => a.taken_on.localeCompare(b.taken_on) || a.id.localeCompare(b.id))) {
    const date = dayOf(row.taken_on), score = numeric(row.score), max = numeric(row.max_score);
    if (!date || date > today || (entry && date < entry) || score == null || max == null || max <= 0 || score < 0 || score > max) continue;
    const group = groups.get(row.subject) ?? []; group.push(row); groups.set(row.subject, group);
  }
  return [...groups].map(([subject, list]) => {
    const first = list[0]!, last = list.at(-1)!;
    // Same label/scale permits raw score comparison, not claims of equal difficulty or causal improvement.
    const comparable = list.length >= 2 && !!subject.trim() && !!first.exam_name.trim()
      && first.exam_name.trim() === last.exam_name.trim() && Number(first.max_score) === Number(last.max_score)
      && first.taken_on !== last.taken_on;
    return { subject, first, last, count: list.length, comparable,
      delta: comparable ? Math.round((Number(last.score) - Number(first.score)) * 10) / 10 : null };
  }).sort((a, b) => a.subject.localeCompare(b.subject));
}

export function levelsOf(rows: readonly Level[], today: string) {
  const groups = new Map<string, Level>();
  for (const row of uniqueRows(rows).sort((a, b) => b.tested_on.localeCompare(a.tested_on) || b.id.localeCompare(a.id))) {
    const date = dayOf(row.tested_on);
    if (!date || date > today || !row.level?.trim()) continue;
    const key = `${row.subject}\0${row.test_type}`;
    if (!groups.has(key)) groups.set(key, row);
  }
  return [...groups.values()];
}

export function attendanceOf(rows: readonly Attendance[], today: string) {
  const from = addDays(today, -27);
  const valid = rows.filter((r) => dayOf(r.session_date) && r.session_date >= from && r.session_date <= today);
  const effective = effectiveAttendanceRecords(valid);
  const observed = effective.filter((r) => ["present", "absent", "late", "excused", "early_leave"].includes(r.status));
  return { count: observed.length, absences: observed.filter((r) => r.status === "absent").length,
    late: observed.filter((r) => r.status === "late").length };
}
