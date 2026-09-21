import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { monthRange } from "@/lib/date-kst";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import { unitsFromMinutes, type AutoUnitsSchedule } from "./auto-units";
import type { AttendanceTermSessions } from "./class-billing";
import { axisDowOf, resolveTaughtBy, type AxisSlot } from "./teacher-axis";

export type TermShareSchedule = AutoUnitsSchedule & Pick<AxisSlot, "teacherId"> & { labSeparate?: boolean };
export type TermShareEnrollment = {
  startDate: string;
  endDate: string | null;
  isTransferred: boolean;
  attendanceDays: readonly string[] | null;
};
/** Empty owner = seat / unassigned time, which must not become the homeroom teacher's share. */
export type TermShareWeights = Map<string, number>;

/** Planned teaching shares, independent of the student's checked attendance and manual units. */
export function teacherTermWeights(input: {
  month: string;
  schedules: readonly TermShareSchedule[];
  enrollments: readonly TermShareEnrollment[];
  homeroomTeacherId: string | null;
  englishTrack: string | null;
  className: string;
  holidays: ReadonlySet<string>;
  scopeTeacherId: string;
  homeroomSince?: string | null;
}): TermShareWeights {
  const { from, to } = monthRange(input.month);
  const weights: TermShareWeights = new Map();
  // Billing includes seats, but excludes separately displayed *LAB alternatives.
  const schedules = input.schedules.filter((s) => !isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate)
    && !/^\s*\*\s*LAB\b/i.test(s.slotTeacherLabel ?? ""));
  const allSlots = schedules.map((s) => ({ ...s, slotTeacherLabel: null }));
  // A shortened Injaewon period does not turn the whole class into a bridge course.
  const fortyMinuteBasis = input.englishTrack === "eie" || /브릿지|브리지|\bbridge\b/i.test(input.className);
  for (let day = new Date(`${from}T00:00:00Z`); day.toISOString().slice(0, 10) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (input.holidays.has(date)) continue;
    const dow = axisDowOf(date)!;
    if (!input.enrollments.some((e) => e.startDate <= date && !isEnrollmentEndedOn(e.endDate, date, e.isTransferred)
      && enrollmentAttendsOnDay(e.attendanceDays, dow))) continue;
    const slots = liveSlotMinutesOn(date, allSlots);
    const lessons: { start: string; minutes: number; owner: string; units: number }[] = [];
    for (const [start, minutes] of slots) {
      if (minutes <= 0) continue;
      const axis = resolveTaughtBy({ homeroomTeacherId: input.homeroomTeacherId, slots: schedules, date, slotStart: start });
      let owner = axis.teacherId ?? "";
      if (axis.source === "homeroom" && owner === input.scopeTeacherId && input.homeroomSince && date < input.homeroomSince) owner = "";
      const units = unitsFromMinutes(minutes, fortyMinuteBasis ? "eie" : "injaewon") ?? 1;
      lessons.push({ start, minutes, owner, units });
    }
    lessons.sort((a, b) => a.start.localeCompare(b.start));
    // Four contiguous 40-minute teaching blocks: the central teacher teaches two units,
    // while the before/after groups share one. E.g. bridge A: Kristine .5 / Jane 2 / Florence .5.
    // Require that exact split pattern; a seat or unrelated four-period timetable is not inferred.
    const toMinutes = (start: string) => Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
    if (fortyMinuteBasis && lessons.length === 4 && lessons.every((s) => s.minutes === 40 && s.owner)
      && lessons[1].owner === lessons[2].owner && lessons[0].owner !== lessons[1].owner && lessons[3].owner !== lessons[1].owner
      && lessons.slice(1).every((s, i) => toMinutes(s.start) - toMinutes(lessons[i].start) === 40)) {
      lessons[0].units = 0.5;
      lessons[3].units = 0.5;
    }
    for (const { owner, units } of lessons) weights.set(owner, (weights.get(owner) ?? 0) + units);
  }
  return weights;
}

/** Use the scheduled periods themselves. Never scale them to make a confirmation fit. */
export function teacherTermSessions(term: AttendanceTermSessions, teacherId: string, weights: TermShareWeights): AttendanceTermSessions {
  if (term.daysBasis) return term;
  const total = [...weights.values()].reduce((sum, n) => sum + n, 0);
  const pending = () => ({ ...term, classUnits: term.units, allocationPending: true });
  if (term.units === 0) return { ...term, classUnits: 0 };
  if (total <= 0) return pending();
  // A sole owner receives the confirmed registration, even if the billed quantity was adjusted.
  // With multiple owners, a different total needs actual period attribution, not a ratio.
  if (weights.size > 1 && Math.abs(total - term.units) > 1e-8) return pending();
  const units = weights.size === 1 ? (weights.has(teacherId) ? term.units : 0) : weights.get(teacherId) ?? 0;
  if ([...weights.values(), units].some((n) => !Number.isFinite(n) || Math.abs(n * 2 - Math.round(n * 2)) > 1e-8)) return pending();
  const halves = units * 2;
  // Only remove floating-point noise; no rounding of teaching quantities.
  return { ...term, units: Math.round(halves) / 2, classUnits: term.units };
}
