import type { EnrollSpan } from "@/features/attendance/enrollment-span";
import type { Counted } from "@/features/attendance/grid/totals";
import type { AttendanceMark } from "@/features/attendance/cell-display";
import type { PeriodWindow } from "@/features/periods/resolve";
import type { SeatMonthDay, SeatTrack } from "./monthly";

export type SeatMonthSlotCell = {
  start: string;
  status: AttendanceMark | null;
  units: number | null;
  track: SeatTrack | null;
};

export type SeatMonthCell = {
  expected: boolean;
  outside: boolean;
  slots: SeatMonthSlotCell[];
};

export type SeatMonthStudent = {
  id: string;
  name: string;
  school: string | null;
  grade: string | null;
  attendDows: number[];
  spans: EnrollSpan[];
  confirmedUnits: number;
  reviewUnits: number;
  counted: Counted;
};

export type SeatMonthGroup = {
  classId: string;
  className: string;
  subject: string;
  scheduleLabel: string;
  confirmedUnits: number;
  reviewUnits: number;
  students: SeatMonthStudent[];
  cells: Record<string, Record<string, SeatMonthCell>>;
};

export type SeatMonthSummary = {
  classCount: number;
  studentCount: number;
  confirmedUnits: number;
  reviewUnits: number;
  present: number;
  absent: number;
  late: number;
  unmarked: number;
};

export type SeatMonthlyView = {
  month: string;
  window: PeriodWindow;
  days: SeatMonthDay[];
  groups: SeatMonthGroup[];
  minutesPerSlot: number | null;
  dateTotals: Record<string, { confirmed: number; review: number }>;
  summary: SeatMonthSummary;
};

export type SeatEnrollRow = {
  classId: string;
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  attendanceDays: string[] | null;
};
