/**
 * 자리 월간 표 조립 — 슬롯·수강·기록을 반별로 접는다(순수).
 * 쿼리는 한 번씩만 읽어 여기로 넘긴다(반 14개 N+1 금지).
 */
import { DOW_KEYS, resolveAttendDows } from "@/features/attendance/calendar";
import { isEnrolledOn, type EnrollSpan } from "@/features/attendance/enrollment-span";
import { countCells } from "@/features/attendance/grid/totals";
import { COUNTABLE_STATUSES } from "@/features/attendance/session-units";
import type { AttendanceMark } from "@/features/attendance/cell-display";
import type { PeriodWindow } from "@/features/periods/resolve";
import type { SpecialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { hhmm } from "./seat";
import {
  classifySeatRecord,
  commonSlotMinutes,
  formatSeatSchedule,
  isSlotLiveOnDate,
  sortClassIdsByFirstSlot,
  sumTrackUnits,
  type SeatAttRecord,
  type SeatMonthDay,
  type SeatSlotDef,
  type SeatTrack,
} from "./monthly";
import type {
  SeatEnrollRow,
  SeatMonthCell,
  SeatMonthGroup,
  SeatMonthSlotCell,
  SeatMonthStudent,
  SeatMonthlyView,
} from "./monthly-view";

export type {
  SeatEnrollRow,
  SeatMonthCell,
  SeatMonthGroup,
  SeatMonthSlotCell,
  SeatMonthStudent,
  SeatMonthSummary,
  SeatMonthlyView,
} from "./monthly-view";

const MARKS = new Set<string>(["present", "absent", "late", "excused", "makeup", "early_leave"]);

export function buildSeatMonthly(input: {
  month: string;
  window: PeriodWindow;
  days: SeatMonthDay[];
  holidays: Record<string, string>;
  slots: readonly SeatSlotDef[];
  classes: readonly { id: string; className: string; subject: string }[];
  enrollments: readonly SeatEnrollRow[];
  records: readonly SeatAttRecord[];
  wantLabel: SpecialSlotLabel;
  periodLabelOf?: (start: string, end: string) => string;
}): SeatMonthlyView {
  const { month, window, days, holidays, slots, classes, enrollments, records, wantLabel, periodLabelOf } = input;
  const classById = new Map(classes.map((c) => [c.id, c]));
  const classIds = sortClassIdsByFirstSlot(
    [...new Set(slots.map((s) => s.classId))].filter((id) => classById.has(id)),
    slots,
  );

  const recByKey = new Map<string, { rec: SeatAttRecord; track: SeatTrack }>();
  for (const rec of records) {
    const track = classifySeatRecord(rec, slots, wantLabel);
    if (!track) continue;
    recByKey.set(`${rec.classId}|${rec.studentId}|${rec.date}|${hhmm(rec.slotStart)}`, { rec, track });
  }

  const dateTotals: Record<string, { confirmed: number; review: number }> = {};
  const groups: SeatMonthGroup[] = [];
  let present = 0;
  let absent = 0;
  let late = 0;
  let unmarked = 0;
  const seenStudents = new Set<string>();

  for (const classId of classIds) {
    const meta = classById.get(classId)!;
    const classSlots = slots.filter((s) => s.classId === classId);
    const classDows = [...new Set(classSlots.map((s) => DOW_KEYS.indexOf(s.dayOfWeek as (typeof DOW_KEYS)[number])).filter((i) => i >= 0))];
    const byStudent = foldEnrollments(enrollments, classId, window);
    const students: SeatMonthStudent[] = [];
    const cells: SeatMonthGroup["cells"] = {};

    for (const { row, spans } of byStudent) {
      const attendDows = resolveAttendDows(row.attendanceDays, classDows);
      const studentCells: Record<string, SeatMonthCell> = {};
      const confirmedRecs: { status: string; sessionUnits: number | null }[] = [];
      const reviewRecs: { status: string; sessionUnits: number | null }[] = [];
      const countedCells: { s: string; u: number | null }[] = [];

      for (const d of days) {
        if (d.placeholder) continue;
        const holiday = Boolean(holidays[d.date]);
        const enrolled = isEnrolledOn(d.date, spans);
        const live = classSlots.filter((s) => isSlotLiveOnDate(s, d.date));
        const expected = enrolled && attendDows.includes(d.dow) && !holiday && live.length > 0;
        const starts = new Set(live.map((s) => hhmm(s.start)));
        for (const [key] of recByKey) {
          const prefix = `${classId}|${row.studentId}|${d.date}|`;
          if (key.startsWith(prefix)) starts.add(key.slice(prefix.length));
        }
        const slotCells: SeatMonthSlotCell[] = [...starts].sort().map((start) => {
          const hit = recByKey.get(`${classId}|${row.studentId}|${d.date}|${start}`);
          if (hit) {
            (hit.track === "confirmed" ? confirmedRecs : reviewRecs).push({
              status: hit.rec.status,
              sessionUnits: hit.rec.sessionUnits,
            });
            const status = asMark(hit.rec.status);
            if (status) countedCells.push({ s: status, u: hit.rec.sessionUnits });
            if (status === "present") present += 1;
            else if (status === "absent" || status === "excused") absent += 1;
            else if (status === "late") late += 1;
            if (COUNTABLE_STATUSES.has(hit.rec.status)) {
              const add = hit.rec.sessionUnits ?? 1;
              const bucket = (dateTotals[d.date] ??= { confirmed: 0, review: 0 });
              if (hit.track === "confirmed") bucket.confirmed += add;
              else bucket.review += add;
            }
            return { start, status, units: hit.rec.sessionUnits, track: hit.track };
          }
          if (expected) unmarked += 1;
          return { start, status: null, units: null, track: null };
        });
        studentCells[d.date] = { expected, outside: !enrolled, slots: slotCells };
      }

      seenStudents.add(row.studentId);
      cells[row.studentId] = studentCells;
      students.push({
        id: row.studentId,
        name: row.name,
        school: row.school,
        grade: row.grade,
        attendDows,
        spans,
        confirmedUnits: sumTrackUnits(confirmedRecs),
        reviewUnits: sumTrackUnits(reviewRecs),
        counted: countCells(countedCells),
      });
    }

    students.sort((a, b) => (a.grade ?? "").localeCompare(b.grade ?? "", "ko") || a.name.localeCompare(b.name, "ko"));
    groups.push({
      classId,
      className: meta.className,
      subject: meta.subject,
      scheduleLabel: formatSeatSchedule(classSlots, classId, periodLabelOf),
      confirmedUnits: students.reduce((a, s) => a + s.confirmedUnits, 0),
      reviewUnits: students.reduce((a, s) => a + s.reviewUnits, 0),
      students,
      cells,
    });
  }

  for (const d of Object.values(dateTotals)) {
    d.confirmed = Math.round(d.confirmed * 10) / 10;
    d.review = Math.round(d.review * 10) / 10;
  }

  return {
    month,
    window,
    days,
    groups,
    minutesPerSlot: commonSlotMinutes(slots),
    dateTotals,
    summary: {
      classCount: groups.length,
      studentCount: seenStudents.size,
      confirmedUnits: Math.round(groups.reduce((a, g) => a + g.confirmedUnits, 0) * 10) / 10,
      reviewUnits: Math.round(groups.reduce((a, g) => a + g.reviewUnits, 0) * 10) / 10,
      present,
      absent,
      late,
      unmarked,
    },
  };
}

function foldEnrollments(enrollments: readonly SeatEnrollRow[], classId: string, window: PeriodWindow) {
  const byStudent = new Map<string, { row: SeatEnrollRow; spans: EnrollSpan[] }>();
  for (const e of enrollments) {
    if (e.classId !== classId || e.onHold) continue;
    if (e.startDate > window.end || (e.endDate && e.endDate < window.start)) continue;
    const cur = byStudent.get(e.studentId);
    const span = { start: e.startDate, end: e.endDate };
    if (cur) cur.spans.push(span);
    else byStudent.set(e.studentId, { row: e, spans: [span] });
  }
  return byStudent.values();
}

function asMark(s: string): AttendanceMark | null {
  return MARKS.has(s) ? (s as AttendanceMark) : null;
}
