import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { enrollmentAttendsOnDay, isEnrollmentActiveOn } from "@/features/enrollments/eligibility";
import { resolvePeriodLabel, tableToEntries } from "../lib/period-label";
import { rosterFormOf, type SheetMark } from "../lib/roster-form";
import { dowKeyOf, normalizeSlotTime } from "../lib/week";
import {
  classNamesOf,
  groupSeatSlots,
  seatAttKey,
  seatRowKey,
  type SeatSlotRef,
} from "../lib/seat-day";
import type { SeatDayPeriod, SeatDayStudent } from "./seat-day-types";

export type SeatEnr = {
  class_id: string;
  student_id: string;
  attendance_days: string[] | null;
  start_date: string;
  end_date: string | null;
  on_hold: boolean;
  is_transferred: boolean | null;
  students: { withdrawn_at: string | null }[] | null;
};

export type SeatMarkRow = {
  class_id: string;
  student_id: string;
  slot_start: string;
  status: string | null;
  progress_note: string | null;
  score?: string | null;
  listening_level?: string | null;
  memorized_words?: string | null;
};

export type SeatAttRow = {
  id: string;
  class_id: string;
  student_id: string;
  status: string;
  note: string | null;
  recorded_at: string;
  session_date: string;
  slot_start: string | null;
  session_units: string | number | null;
};

export type SeatStudentRow = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  english_name: string | null;
};

function withdrawnAt(
  raw: SeatEnr["students"] | { withdrawn_at: string | null } | null,
): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.withdrawn_at ?? null;
  return raw.withdrawn_at ?? null;
}

function toMark(m: SeatMarkRow): SheetMark {
  return {
    status: m.status,
    progressNote: m.progress_note,
    score: m.score ?? null,
    listeningLevel: m.listening_level ?? null,
    memorizedWords: m.memorized_words ?? null,
  };
}

export function assembleSeatPeriods(input: {
  date: string;
  dow: ReturnType<typeof dowKeyOf>;
  slots: SeatSlotRef[];
  enrollments: SeatEnr[];
  marksRaw: SeatMarkRow[];
  attendanceRaw: SeatAttRow[];
  studentRows: SeatStudentRow[];
  canWriteEcs: boolean;
  attendanceWritable: boolean;
  teachingSet: Set<string> | null;
  periodTables: { weekday: ReturnType<typeof tableToEntries>; weekend: ReturnType<typeof tableToEntries> };
  weekend: boolean;
}): SeatDayPeriod[] {
  const students = new Map(input.studentRows.map((s) => [s.id, s]));
  const effective = effectiveAttendanceRecords(input.attendanceRaw);
  const attByKey = new Map<string, (typeof effective)[number]>();
  for (const r of effective) {
    if (!r.slot_start) continue;
    attByKey.set(seatAttKey(r.class_id, r.student_id, r.slot_start), r);
  }
  const markByKey = new Map<string, SheetMark>();
  for (const m of input.marksRaw) {
    markByKey.set(seatAttKey(m.class_id, m.student_id, m.slot_start), toMark(m));
  }

  return groupSeatSlots(input.slots).map((bucket) => {
    const classIds = new Set(bucket.items.map((i) => i.classId));
    const classNameOf = new Map(bucket.items.map((i) => [i.classId, i.className]));
    const seen = new Set<string>();
    const rows: SeatDayStudent[] = [];

    const push = (classId: string, studentId: string, eligible: boolean, endedOn: string | null) => {
      const key = seatRowKey(classId, studentId);
      if (seen.has(key)) return;
      seen.add(key);
      const meta = students.get(studentId);
      const att = attByKey.get(seatAttKey(classId, studentId, bucket.slotStart));
      const rawUnits = att?.session_units;
      const units = rawUnits == null ? null : Number(rawUnits);
      rows.push({
        studentId,
        classId,
        className: classNameOf.get(classId) ?? "",
        name: meta?.name ?? "?",
        englishName: meta?.english_name ?? null,
        school: meta?.school ?? null,
        grade: meta?.grade ?? null,
        eligible,
        historical: !eligible,
        endedOn,
        mark: markByKey.get(seatAttKey(classId, studentId, bucket.slotStart)) ?? null,
        attendance: att
          ? {
              status: att.status,
              note: att.note,
              units: Number.isFinite(units) ? units : null,
              slot: att.slot_start ?? bucket.slotStart,
            }
          : null,
        canMarkAttendance:
          eligible &&
          input.attendanceWritable &&
          (input.teachingSet === null || input.teachingSet.has(classId)),
        canEditMark: eligible && input.canWriteEcs,
      });
    };

    for (const e of input.enrollments) {
      if (!classIds.has(e.class_id)) continue;
      const withdrawn = withdrawnAt(e.students);
      if (withdrawn && withdrawn < input.date) continue;
      const active = isEnrollmentActiveOn(
        {
          startDate: e.start_date,
          endDate: e.end_date,
          onHold: e.on_hold,
          isTransferred: e.is_transferred ?? undefined,
        },
        input.date,
      );
      if (!active || !enrollmentAttendsOnDay(e.attendance_days, input.dow)) continue;
      push(e.class_id, e.student_id, true, null);
    }
    for (const r of effective) {
      if (!r.slot_start || normalizeSlotTime(r.slot_start) !== bucket.slotStart) continue;
      if (!classIds.has(r.class_id)) continue;
      push(r.class_id, r.student_id, false, null);
    }
    for (const m of input.marksRaw) {
      if (normalizeSlotTime(m.slot_start) !== bucket.slotStart) continue;
      if (!classIds.has(m.class_id)) continue;
      push(m.class_id, m.student_id, false, null);
    }

    rows.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.className.localeCompare(b.className, "ko"));
    return {
      slotStart: bucket.slotStart,
      slotEnd: bucket.slotEnd,
      ends: bucket.ends,
      periodLabel: resolvePeriodLabel(bucket.slotStart, bucket.slotEnd, input.periodTables, input.weekend),
      form: rosterFormOf(bucket.items[0]?.slotTeacherLabel),
      classNames: classNamesOf(bucket.items),
      students: rows,
    };
  });
}
