import { addDays } from "@/lib/date-kst";
import { enrollmentLastDate } from "@/features/enrollments/eligibility";
import { dayCount, dayOf, uniqueRows } from "./dates";
import type { Enrollment } from "./types";

/** Registration intervals only. Historical hold dates are not present on enrollment rows. */
export function tenureOf(rows: readonly Enrollment[], today: string, enrolledAt: string | null) {
  const intervals: { start: string; end: string }[] = [];
  let invalid = 0;
  let onHold = false;
  for (const row of uniqueRows(rows)) {
    const start = dayOf(row.start_date), rawEnd = dayOf(row.end_date);
    if (!start || (row.end_date != null && !rawEnd)) { invalid++; continue; }
    if (start > today) continue;
    const end = enrollmentLastDate(rawEnd, row.is_transferred === true) ?? today;
    if (end < start) { invalid++; continue; }
    if (row.on_hold && end >= today) onHold = true;
    intervals.push({ start, end: end > today ? today : end });
  }
  intervals.sort((a, b) => a.start.localeCompare(b.start));
  const merged: typeof intervals = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= addDays(last.end, 1)) {
      if (interval.end > last.end) last.end = interval.end;
    } else merged.push({ ...interval });
  }
  const entry = dayOf(enrolledAt);
  const candidates = [entry && entry <= today ? entry : null, merged[0]?.start].filter((s): s is string => !!s);
  return {
    first: candidates.sort()[0] ?? null,
    registeredDays: merged.length ? merged.reduce((sum, r) => sum + dayCount(r.start, r.end), 0) : null,
    currentDays: !onHold && merged.at(-1)?.end === today ? dayCount(merged.at(-1)!.start, today) : null,
    intervals: merged.length, invalid, onHold,
  };
}
