import type { EnrollSpan, LifecycleBadge, OtherSpan } from "@/features/attendance/enrollment-span";
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
  /** 이름 옆 표식(신입·퇴원·반이동) — 반별 출석부와 같은 규약·같은 판정. */
  badges: LifecycleBadge[];
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

/** 표식 판정에 쓰는 **다른 반** 수강 구간(반이동 상대). 없으면 신입·퇴원까지만 나온다. */
export type SeatOtherSpan = OtherSpan;

export type SeatEnrollRow = {
  classId: string;
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  startDate: string;
  endDate: string | null;
  /** 반이동으로 끝난 구간인가 — 종료 규약이 갈린다([EnrollSpan](@/features/attendance/enrollment-span)). */
  isTransferred: boolean;
  onHold: boolean;
  attendanceDays: string[] | null;
};
