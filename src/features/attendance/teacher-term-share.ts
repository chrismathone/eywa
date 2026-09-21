import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { monthRange } from "@/lib/date-kst";
import { shiftDays } from "@/features/timetable/lib/week";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import { unitsFromMinutes, usesFortyMinuteEnglishUnits, type AutoUnitsSchedule } from "./auto-units";
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
export type TermShareWeights = Map<string, number> & { homeroomTeacherId?: string | null };

/** Shared daily plan for registration allocation and the student units master. */
export function teacherLessonsOn(input: {
  date: string; schedules: readonly TermShareSchedule[]; homeroomTeacherId: string | null;
  englishTrack: string | null; className: string;
  scopeTeacherId?: string; homeroomSince?: string | null;
}) {
  const { date } = input;
  const schedules = input.schedules.filter((s) => !isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate)
    && !/^\s*\*\s*LAB\b/i.test(s.slotTeacherLabel ?? ""));
  const fortyMinuteBasis = usesFortyMinuteEnglishUnits(date, schedules, input.englishTrack, input.className);
  const slots = liveSlotMinutesOn(date, schedules.map((s) => ({ ...s, slotTeacherLabel: null })));
  const lessons = [...slots].filter(([, minutes]) => minutes > 0).map(([start, minutes]) => {
    const axis = resolveTaughtBy({ homeroomTeacherId: input.homeroomTeacherId, slots: schedules, date, slotStart: start });
    let owner = axis.teacherId ?? "";
    if (axis.source === "homeroom" && owner === input.scopeTeacherId && input.homeroomSince && date < input.homeroomSince) owner = "";
    return { start, minutes, owner, source: axis.source,
      units: unitsFromMinutes(minutes, fortyMinuteBasis ? "eie" : "injaewon") ?? 1 };
  }).sort((a, b) => a.start.localeCompare(b.start));
  const toMinutes = (start: string) => Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  if (fortyMinuteBasis && lessons.length === 4 && lessons.every((s) => s.minutes === 40 && s.owner)
    && lessons[1].owner === lessons[2].owner && lessons[0].owner !== lessons[1].owner && lessons[3].owner !== lessons[1].owner
    && lessons.slice(1).every((s, i) => toMinutes(s.start) - toMinutes(lessons[i].start) === 40)) {
    lessons[0].units = 0.5;
    lessons[3].units = 0.5;
  }
  return lessons;
}

/** Planned teaching shares, independent of the student's checked attendance and manual units. */
export function teacherTermWeights(input: {
  month: string;
  window?: { from: string; to: string };
  schedules: readonly TermShareSchedule[];
  enrollments: readonly TermShareEnrollment[];
  homeroomTeacherId: string | null;
  englishTrack: string | null;
  className: string;
  holidays: ReadonlySet<string>;
  scopeTeacherId: string;
  homeroomSince?: string | null;
}): TermShareWeights {
  const { from, to } = input.window ?? monthRange(input.month);
  const weights: TermShareWeights = new Map();
  weights.homeroomTeacherId = input.homeroomTeacherId;
  for (let day = new Date(`${from}T00:00:00Z`); day.toISOString().slice(0, 10) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (input.holidays.has(date)) continue;
    const dow = axisDowOf(date)!;
    if (!input.enrollments.some((e) => e.startDate <= date && !isEnrollmentEndedOn(e.endDate, date, e.isTransferred)
      && enrollmentAttendsOnDay(e.attendanceDays, dow))) continue;
    for (const lesson of teacherLessonsOn({ ...input, date })) {
      weights.set(lesson.owner, (weights.get(lesson.owner) ?? 0) + lesson.units);
    }
  }
  return weights;
}

/** EiE registration: every weekday in the reference timetable occurs exactly four times. */
export function teacherFourWeekWeights(input: {
  referenceDate: string;
  schedules: readonly TermShareSchedule[];
  homeroomTeacherId: string | null;
  className: string;
}): TermShareWeights {
  const from = input.referenceDate;
  const to = shiftDays(from, 6);
  // Freeze the timetable at the reference date, including its *LAB toggles. This is a
  // class registration basis, not a count of calendar holidays or a student's attendance.
  const schedules = input.schedules.filter((s) => s.validFrom <= from && (!s.validTo || s.validTo >= from))
    .map((s) => ({ ...s, validFrom: from, validTo: to }));
  const week = teacherTermWeights({
    month: from.slice(0, 7), window: { from, to }, schedules, englishTrack: "eie", className: input.className,
    homeroomTeacherId: input.homeroomTeacherId, scopeTeacherId: input.homeroomTeacherId ?? "", holidays: new Set(),
    enrollments: [{ startDate: from, endDate: to, isTransferred: false, attendanceDays: null }],
  });
  return Object.assign(new Map([...week].map(([owner, units]) => [owner, units * 4])), { homeroomTeacherId: input.homeroomTeacherId });
}

/** Scheduled units first; any positive unallocated confirmation belongs to the homeroom teacher. */
export function teacherTermSessions(term: AttendanceTermSessions, teacherId: string, weights: TermShareWeights): AttendanceTermSessions {
  if (term.daysBasis) return term;
  const total = [...weights.values()].reduce((sum, n) => sum + n, 0);
  const pending = () => ({ ...term, classUnits: term.units, allocationPending: true });
  if (term.units === 0) return { ...term, classUnits: 0 };
  const remainder = term.units - total;
  let units = weights.get(teacherId) ?? 0;
  if (remainder > 1e-8) {
    if (!weights.homeroomTeacherId) return pending();
    if (teacherId === weights.homeroomTeacherId) units += remainder;
  } else if (remainder < -1e-8) {
    // A lower confirmation with several owners still needs an explicit reduction rule.
    if (weights.size !== 1) return pending();
    units = weights.has(teacherId) ? term.units : 0;
  }
  if ([...weights.values(), units].some((n) => !Number.isFinite(n) || Math.abs(n * 2 - Math.round(n * 2)) > 1e-8)) return pending();
  const halves = units * 2;
  // Only remove floating-point noise; no rounding of teaching quantities.
  return { ...term, units: Math.round(halves) / 2, classUnits: term.units };
}
