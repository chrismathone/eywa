import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { monthRange } from "@/lib/date-kst";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import type { AutoUnitsSchedule } from "./auto-units";
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
  holidays: ReadonlySet<string>;
  scopeTeacherId: string;
  homeroomSince?: string | null;
}): TermShareWeights {
  const { from, to } = monthRange(input.month);
  const weights: TermShareWeights = new Map();
  // Billing includes seats, but excludes separately displayed *LAB alternatives.
  const schedules = input.schedules.filter((s) => !isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate));
  const allSlots = schedules.map((s) => ({ ...s, slotTeacherLabel: null }));
  // A bridge class keeps the 40-minute basis on its 60-minute-only weekdays too.
  const fortyMinuteBasis = input.englishTrack === "eie" || schedules.some((s) => {
    const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
    return s.validFrom <= to && (!s.validTo || s.validTo >= from) && minutes(s.endTime) - minutes(s.startTime) === 40;
  });
  for (let day = new Date(`${from}T00:00:00Z`); day.toISOString().slice(0, 10) <= to; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (input.holidays.has(date)) continue;
    const dow = axisDowOf(date)!;
    if (!input.enrollments.some((e) => e.startDate <= date && !isEnrollmentEndedOn(e.endDate, date, e.isTransferred)
      && enrollmentAttendsOnDay(e.attendanceDays, dow))) continue;
    const slots = liveSlotMinutesOn(date, allSlots);
    for (const [start, minutes] of slots) {
      if (minutes <= 0) continue;
      const axis = resolveTaughtBy({ homeroomTeacherId: input.homeroomTeacherId, slots: schedules, date, slotStart: start });
      let owner = axis.teacherId ?? "";
      if (axis.source === "homeroom" && owner === input.scopeTeacherId && input.homeroomSince && date < input.homeroomSince) owner = "";
      const units = fortyMinuteBasis ? minutes / 40 : Math.ceil(minutes / 60);
      weights.set(owner, (weights.get(owner) ?? 0) + units);
    }
  }
  return weights;
}

/** Apportion tenths deterministically so teacher + seat shares sum to the confirmed class total. */
export function teacherTermSessions(term: AttendanceTermSessions, teacherId: string, weights: TermShareWeights): AttendanceTermSessions {
  if (term.daysBasis) return term;
  const total = [...weights.values()].reduce((sum, n) => sum + n, 0);
  if (total <= 0 && term.units !== 0) return { ...term, classUnits: term.units, allocationPending: true };
  const tenths = Math.round(term.units * 10);
  const parts = [...weights].map(([id, n]) => {
    const exact = total > 0 ? tenths * n / total : 0;
    return { id, units: Math.floor(exact), remainder: exact - Math.floor(exact) };
  }).sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id));
  const left = tenths - parts.reduce((sum, p) => sum + p.units, 0);
  for (let i = 0; i < left && i < parts.length; i++) parts[i]!.units++;
  return { ...term, units: (parts.find((p) => p.id === teacherId)?.units ?? 0) / 10, classUnits: term.units };
}
