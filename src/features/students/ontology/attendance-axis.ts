import { resolveRecordTaughtBy, type AxisSlot, type RecordTeacherAxis } from "@/features/attendance/teacher-axis";
import { homeroomTeacherOnDate, type HomeroomPeriod } from "@/features/classes/teacher-as-of";

/** Historical display never fills an unknown teacher from today's assignment. */
export function ontologyAttendanceAxis(input: { date: string; today: string; historyFrom: string; currentTeacher: string | null;
  history: readonly HomeroomPeriod[]; slots: AxisSlot[]; taughtBy: string | null; slotStart: string | null;
  seatLabel?: string | null; recordedVia?: string | null }): RecordTeacherAxis {
  // Same precedence as ownsAttendanceSlot: explicit taught_by first, then durable seat markers.
  if (!input.taughtBy && (input.seatLabel?.trim() || input.recordedVia === "seat")) return { teacherId: null, source: "seat" };
  const historical = input.date >= input.historyFrom ? input.history : [];
  const period = historical.find((p) => (!p.from || p.from <= input.date) && (!p.to || input.date < p.to));
  const hasEvidence = input.date === input.today || !!period;
  return resolveRecordTaughtBy({ date: input.date, slotStart: input.slotStart, taughtBy: input.taughtBy, slots: input.slots,
    homeroomTeacherId: hasEvidence ? homeroomTeacherOnDate(historical, input.currentTeacher, input.date) : null });
}
