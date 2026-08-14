import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import type { EcsFontSize } from "../font-size";
import type { RosterForm, SheetMark } from "../lib/roster-form";

export type SeatDayStudent = {
  studentId: string;
  classId: string;
  className: string;
  name: string;
  englishName: string | null;
  school: string | null;
  grade: string | null;
  eligible: boolean;
  historical: boolean;
  endedOn: string | null;
  mark: SheetMark | null;
  attendance: { status: string; note: string | null; units: number | null; slot: string | null } | null;
  canMarkAttendance: boolean;
  canEditMark: boolean;
};

export type SeatDayPeriod = {
  slotStart: string;
  slotEnd: string | null;
  ends: string[];
  periodLabel: string | null;
  form: RosterForm;
  classNames: string[];
  students: SeatDayStudent[];
};

export type SeatDayData = {
  date: string;
  today: string;
  seat: SpecialSlotLabel;
  periods: SeatDayPeriod[];
  userId: string;
  tenantId: string;
  canWriteEcs: boolean;
  fontSize: EcsFontSize;
};

export type SeatDayResult = { ok: true; data: SeatDayData } | { ok: false; error: string };
