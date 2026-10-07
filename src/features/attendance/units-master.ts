import { effectiveAttendanceRecords, type EffectiveAttendanceRecord } from "./effective-records";
import { axisDowOf, normalizeAxisTime, resolveTaughtBy, slotLiveOn } from "./teacher-axis";
import { teacherLessonsOn, type TermShareEnrollment, type TermShareSchedule } from "./teacher-term-share";
import { COUNTABLE_STATUSES } from "./session-units";
import { enrollmentAttendsOnDay, isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import type { AttendanceTermSessions } from "./class-billing";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import { unitsFromMinutes } from "./auto-units";

export type MasterRecord = EffectiveAttendanceRecord & {
  status: string; session_units: number | string | null; seat_label: string | null; recorded_via: string | null;
  taught_by?: string | null;
};
export type MasterLesson = { date: string; start: string; end: string; owner: string; units: number };
export type MasterEvent = { date: string; slot: string | null; owner: string; status: string; units: number; note: string; excluded?: boolean };
export type MasterStudent = {
  id: string; name: string; school: string; target: number | null; invoice: "ok" | "none" | "void";
  actual: number; future: number; missing: number; remaining: number | null; review: string[];
  owners: Record<string, { actual: number; planned: number | null }>;
  events: MasterEvent[]; status: MasterStatus;
};
export type MasterStatus = "normal" | "short" | "review" | "complete" | "excess" | "plannedExcess" | "unconfirmed";
export type MasterClass = {
  id: string; name: string; subject: "math" | "english"; track: "math" | "eie" | "bridge" | "hourly"; from: string; to: string; periodLabel: string;
  teachers: { id: string; name: string }[]; students: MasterStudent[];
};
export type UnitsMaster = { month: string; asOf: string; classes: MasterClass[] };
export const MASTER_SEATS = ["JJ", "LAB"] as const;
export const MASTER_UNKNOWN = "unassigned";
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const separate = (s: TermShareSchedule) => isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate) || /^\s*\*\s*LAB\b/i.test(s.slotTeacherLabel ?? "");
const seat = (label: string | null | undefined) => specialSlotLabel(label?.replace(/^\s*\*\s*/, ""));

function candidates(schedules: readonly TermShareSchedule[], date: string, start: string | null) {
  return schedules.filter((s) => slotLiveOn(s, date) && s.dayOfWeek === axisDowOf(date)
    && (!start || normalizeAxisTime(s.startTime) === normalizeAxisTime(start)));
}

/** Seats are facts about the lesson, never the user who entered attendance. */
export function masterOwner(schedules: readonly TermShareSchedule[], home: string | null, date: string,
  start: string | null, label?: string | null, via?: string | null): string {
  const explicitSeat = seat(label);
  if (explicitSeat) return explicitSeat;
  const slots = candidates(schedules, date, start);
  const seats = new Set(slots.filter((s) => !s.teacherId).map((s) => seat(s.slotTeacherLabel)).filter(Boolean));
  if (via === "seat") return seats.size === 1 ? [...seats][0]! : MASTER_UNKNOWN;
  // A day row spanning a teacher and JJ/LAB cannot be assigned wholly to that teacher.
  if (!start && seats.size && slots.some((s) => !seat(s.slotTeacherLabel))) return MASTER_UNKNOWN;
  const axis = resolveTaughtBy({ slots: schedules, homeroomTeacherId: home, date, slotStart: start });
  if (axis.source === "seat") return seats.size === 1 ? [...seats][0]! : MASTER_UNKNOWN;
  return axis.teacherId ?? MASTER_UNKNOWN;
}

export function masterPlan(input: {
  from: string; to: string; schedules: readonly TermShareSchedule[]; homeroomTeacherId: string | null;
  englishTrack: string | null; className: string; holidays: ReadonlySet<string>;
  subject?: "math" | "english";
}): MasterLesson[] {
  const out: MasterLesson[] = [];
  for (const day = new Date(`${input.from}T00:00:00Z`); day.toISOString().slice(0, 10) <= input.to; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (input.holidays.has(date)) continue;
    if (input.subject === "math") {
      const eligible = input.schedules.filter((s) => !separate(s));
      for (const [start, minutes] of liveSlotMinutesOn(date, eligible)) {
        if (minutes <= 0) continue;
        const end = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5)) + minutes;
        out.push({ date, start, end: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
          owner: masterOwner(eligible, input.homeroomTeacherId, date, start), units: unitsFromMinutes(minutes, "math") ?? 1 });
      }
      continue;
    }
    for (const l of teacherLessonsOn({ ...input, date })) {
      const minutes = Number(l.start.slice(0, 2)) * 60 + Number(l.start.slice(3, 5)) + l.minutes;
      out.push({ date, start: l.start, end: `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
        owner: l.owner || masterOwner(input.schedules, input.homeroomTeacherId, date, l.start), units: l.units });
    }
  }
  return out;
}

/** Confirmation and attendance problems are independent: pending billing must not hide missing attendance. */
export function masterNeedsInput(row: Pick<MasterStudent, "review" | "missing">): boolean {
  return row.review.length > 0 || row.missing > 0;
}

export function masterMatchesFilter(row: MasterStudent, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "review") return masterNeedsInput(row);
  if (filter === "attention") return masterNeedsInput(row) || !["normal", "complete"].includes(row.status);
  if (filter === "excess") return ["excess", "plannedExcess"].includes(row.status);
  return row.status === filter;
}

/** Input problems come first, then confirmed shortages/excess, then confirmation work. */
export function masterPriority(row: MasterStudent): number {
  if (masterNeedsInput(row)) return 0;
  if (["short", "excess", "plannedExcess"].includes(row.status)) return 1;
  return row.target === null ? 2 : 3;
}

export function masterStatus(row: Pick<MasterStudent, "target" | "actual" | "future" | "review" | "missing">): MasterStatus {
  if (row.target === null) return "unconfirmed";
  if (row.review.length || row.missing > 0) return "review";
  const remaining = round(row.target - row.actual);
  if (remaining < 0) return "excess";
  if (remaining === 0) return "complete";
  const gap = round(remaining - row.future);
  return gap > 0 ? "short" : gap < 0 ? "plannedExcess" : "normal";
}

/** Whole-class actuals come from raw effective records once, not summed teacher screens. */
export function buildMasterStudent(input: {
  student: { id: string; name: string; school: string }; records: readonly MasterRecord[];
  schedules: readonly TermShareSchedule[]; enrollments: readonly TermShareEnrollment[];
  plan: readonly MasterLesson[]; allocation: ReadonlyMap<string, number>;
  term?: AttendanceTermSessions; invoice: MasterStudent["invoice"]; homeroomTeacherId: string | null;
  from: string; to: string; asOf: string; sessionUnmapped: boolean;
  reservations?: readonly MasterLesson[];
}): MasterStudent {
  const { student, schedules, homeroomTeacherId: home, asOf } = input;
  const issues = new Set<string>();
  const target = input.term && !input.term.daysBasis ? input.term.units : null;
  if (input.term?.daysBasis) issues.add("등록 기준이 일수로 저장되어 U 비교가 필요합니다");
  if (input.sessionUnmapped) issues.add("EiE 4회 세션과 실제 수업 날짜의 대응을 확인해 주세요");
  const owners: MasterStudent["owners"] = {};
  const owner = (id: string) => owners[id] ??= { actual: 0, planned: 0 };
  for (const [id, units] of input.allocation) owner(id).planned = units;
  if (target !== null) {
    const scheduled = [...input.allocation.values()].reduce((a, b) => a + b, 0);
    if (target > scheduled && home) owner(home).planned! += round(target - scheduled);
    else if (target !== scheduled) {
      if (input.allocation.size === 1) owner([...input.allocation.keys()][0]).planned = target;
      else {
        issues.add("확정 시수와 담당별 배분을 확인해 주세요");
        for (const value of Object.values(owners)) value.planned = null;
      }
    }
  }
  const records = effectiveAttendanceRecords(input.records.filter((r) => r.student_id === student.id
    && r.session_date >= input.from && r.session_date <= input.to)
    .map((r) => ({ ...r, slot_start: normalizeAxisTime(r.slot_start) })));
  const byDay = new Map<string, MasterRecord[]>();
  for (const r of records) {
    const rows = byDay.get(r.session_date) ?? [];
    rows.push(r); byDay.set(r.session_date, rows);
  }
  const events: MasterEvent[] = [];
  const counted = new Set<string>();
  const dayCovered = new Set<string>();
  let actual = 0;
  for (const [date, rows] of byDay) {
    if (`${date}T00:00` > asOf) continue;
    const periods = rows.filter((r) => r.slot_start);
    for (const r of rows) {
      const start = normalizeAxisTime(r.slot_start);
      const scheduledOwner = masterOwner(schedules, home, date, start, r.seat_label, r.recorded_via);
      const own = r.taught_by && !["JJ", "LAB"].includes(scheduledOwner) && r.recorded_via !== "seat" ? r.taught_by : scheduledOwner;
      const matching = candidates(schedules, date, start);
      const excludedLab = /^\s*\*\s*LAB/i.test(r.seat_label ?? "") || (!!start && matching.length > 0 && matching.every(separate));
      // LAB has its own fact axis. A day row plus teacher/JJ periods is ambiguous; never sum both.
      const overlap = !start && periods.some((p) => masterOwner(schedules, home, date, p.slot_start ?? null, p.seat_label, p.recorded_via) !== "LAB");
      const raw = r.session_units === null ? 1 : Number(r.session_units);
      const valid = Number.isFinite(raw) && raw >= 0;
      const units = COUNTABLE_STATUSES.has(r.status) && valid ? raw : 0;
      if (overlap) issues.add(`${date}: 일별 기록과 교시별 기록이 겹칩니다`);
      if (!valid) issues.add(`${date}: 시수 값을 확인해 주세요`);
      const excluded = excludedLab || overlap || !valid;
      if (!excluded) {
        actual += units; owner(own).actual += units;
        if (own === MASTER_UNKNOWN) issues.add(`${date}: 담당을 구분할 수 없는 기록이 있습니다`);
        if (start) counted.add(`${date}|${start}`); else dayCovered.add(date);
      }
      events.push({ date, slot: start, owner: own, status: r.status, units, excluded,
        note: excludedLab ? "*LAB · 합계 제외" : overlap ? "일별·교시 겹침 · 일별 기록은 합계 보류" : !valid ? "시수 확인" : own !== scheduledOwner ? "실제 수업 강사로 귀속" : "" });
    }
  }
  const expected = input.plan.filter((l) => input.enrollments.some((e) => e.startDate <= l.date
    && !isEnrollmentEndedOn(e.endDate, l.date, e.isTransferred) && enrollmentAttendsOnDay(e.attendanceDays, axisDowOf(l.date)!)));
  const lessons = new Map(expected.map((l) => [`${l.date}|${l.start}`, l]));
  for (const l of input.reservations ?? []) if (!lessons.has(`${l.date}|${l.start}`)) lessons.set(`${l.date}|${l.start}`, l);
  let future = 0, missing = 0;
  for (const [key, l] of lessons) {
    if (counted.has(key) || dayCovered.has(l.date)) continue;
    if (`${l.date}T${l.end}` > asOf) future += l.units;
    else {
      missing += l.units;
      events.push({ date: l.date, slot: l.start, owner: l.owner, status: "unmarked", units: l.units, note: "출결 미입력" });
    }
  }
  const row = { ...student, target, invoice: input.invoice, actual: round(actual), future: round(future), missing: round(missing),
    remaining: target === null ? null : round(target - actual), review: [...issues], owners,
    events: events.sort((a, b) => b.date.localeCompare(a.date) || (a.slot ?? "").localeCompare(b.slot ?? "")) };
  return { ...row, status: masterStatus(row) };
}
