// ECS 주간 그리드 조립 — 순수(Vitest). **실날짜별** 정확성이 계약이다(계획 v2.2 §E·§F):
//  · 슬롯 유효성: 각 날짜에 valid_from ≤ date ≤ valid_to 인 스케줄만 "그 날 수업"이다(주 대표일 1회 판정 금지
//    — 주중 시간표 변경 주에 옛/새 스케줄이 같은 주에 걸친다).
//  · 로스터: 날짜별 isEnrollmentActiveOn(입퇴반·반이동 반열림 규약) + 분리등원(attendance_days) +
//    students.withdrawn_at. 단 attendance_days/on_hold는 이력이 없어 **현재값 기준**(비보장 명시 — eywa 전
//    화면과 동일 한계).
//  · 과거 데이터 보존: 로스터 = eligible ∪ 그 슬롯 mark 보유 ∪ 그 날짜 effective 출석 보유(비eligible은
//    historical 읽기 전용). 스케줄 없는 날짜의 출석은 가짜 슬롯을 만들지 않고 attendanceOnly로 분리.
//  · 고아 슬롯: 계획·마크·슬롯 메모가 있는데 그 날짜 스케줄에 없는 (date,slot) — 표시는 유지(소실 금지).
import { isEnrollmentActiveOn, enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { isMeaningfulPlanLine } from "./plan-codec";
import { dowKeyOf, normalizeSlotTime, weekDatesOf, type DowKey } from "./week";

export type GridScheduleRow = {
  dayOfWeek: DowKey;
  startTime: string; // "HH:MM[:SS]"
  endTime: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string | null;
  teacherId: string | null;
  slotTeacherLabel: string | null;
  slotRoomLabel: string | null;
};

export type GridEnrollmentRow = {
  studentId: string;
  startDate: string;
  endDate: string | null;
  onHold: boolean;
  isTransferred?: boolean;
  attendanceDays: readonly string[] | null;
  /** students.withdrawn_at — 퇴원 확정일 이후 날짜는 eligible에서 제외. */
  withdrawnAt?: string | null;
};

export type GridPlanLine = {
  id: string;
  planDate: string;
  slotStart: string;
  termMode: "regular" | "exam";
  skillArea: string;
  lineNo: number;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  homework: string | null;
  updatedAt: string;
};

export type GridMark = {
  studentId: string;
  markDate: string;
  slotStart: string;
  status: string | null;
  progressNote: string | null;
};

export type GridAttendance = {
  studentId: string;
  sessionDate: string;
  status: string; // attendance_status enum 원문
};

export type RosterEntry = {
  studentId: string;
  /** 그 날짜 실제 수강 대상(계획 표시·마크 입력 허용). */
  eligible: boolean;
  /** 비eligible인데 기록(마크/출석)이 있어 보존 표시되는 행 — 읽기 전용. */
  historical: boolean;
};

export type GridSlot = {
  slotStart: string; // "HH:MM"
  slotEnd: string | null; // 고아 슬롯은 null
  /** 그 날짜에 유효한 스케줄이 실재하는가. false=고아(시간 변경됨 — 데이터만 남음). */
  scheduled: boolean;
  teacherId: string | null;
  teacherLabel: string | null; // slot_teacher_label 원문(표시 해석은 소비처)
  roomLabel: string | null;
  lines: GridPlanLine[]; // regular 먼저, line_no 순
  roster: RosterEntry[];
};

export type GridDay = {
  date: string;
  dow: DowKey;
  slots: GridSlot[];
};

export type WeekGrid = {
  weekMonday: string;
  days: GridDay[]; // 슬롯(스케줄 or 고아 데이터)이 있는 날짜만
  /** 스케줄이 전혀 없는 날짜의 출석 기록 — 별도 영역 표시(가짜 슬롯 금지). */
  attendanceOnly: { date: string; studentIds: string[] }[];
};

function slotKey(date: string, slot: string): string {
  return `${date}|${slot}`;
}

/**
 * 그 주에 **실날짜별로 유효한** (date, "HH:MM") 스케줄 키 집합 — buildWeekGrid와 랜딩 작성률이 공유
 * (슬롯 유효성 판정을 두 곳에서 따로 구현하지 않는다).
 */
export function scheduledSlotKeySet(
  weekMonday: string,
  schedules: readonly Pick<GridScheduleRow, "dayOfWeek" | "startTime" | "validFrom" | "validTo">[],
): Set<string> {
  const out = new Set<string>();
  for (const date of weekDatesOf(weekMonday)) {
    const dow = dowKeyOf(date);
    for (const s of schedules) {
      if (s.dayOfWeek !== dow) continue;
      if (s.validFrom > date) continue;
      if (s.validTo && s.validTo < date) continue;
      out.add(slotKey(date, normalizeSlotTime(s.startTime)));
    }
  }
  return out;
}

const TERM_ORDER: Record<string, number> = { regular: 0, exam: 1 };

export function buildWeekGrid(input: {
  weekMonday: string;
  schedules: GridScheduleRow[];
  enrollments: GridEnrollmentRow[];
  planLines: GridPlanLine[];
  marks: GridMark[];
  attendance: GridAttendance[];
  /** 슬롯 메모 키("slot:<date>:<HH:MM>") — 고아 판정 합집합에 포함. */
  slotMemoKeys: string[];
}): WeekGrid {
  const dates = weekDatesOf(input.weekMonday);
  const dateSet = new Set(dates);

  // (date, slot) → 스케줄(그 날짜에 유효한 것만) — 유효성 규칙은 scheduledSlotKeySet과 동일
  const scheduledByKey = new Map<string, GridScheduleRow>();
  for (const date of dates) {
    const dow = dowKeyOf(date);
    for (const s of input.schedules) {
      if (s.dayOfWeek !== dow) continue;
      if (s.validFrom > date) continue;
      if (s.validTo && s.validTo < date) continue;
      const key = slotKey(date, normalizeSlotTime(s.startTime));
      if (!scheduledByKey.has(key)) scheduledByKey.set(key, s);
    }
  }

  // 데이터 보유 (date, slot) 합집합 — 계획 ∪ 마크 ∪ 슬롯 메모(고아 슬롯 보존)
  const dataKeys = new Set<string>();
  const linesByKey = new Map<string, GridPlanLine[]>();
  for (const l of input.planLines) {
    if (!dateSet.has(l.planDate)) continue;
    const key = slotKey(l.planDate, normalizeSlotTime(l.slotStart));
    dataKeys.add(key);
    const arr = linesByKey.get(key) ?? [];
    arr.push(l);
    linesByKey.set(key, arr);
  }
  const marksByKey = new Map<string, GridMark[]>();
  for (const m of input.marks) {
    if (!dateSet.has(m.markDate)) continue;
    const key = slotKey(m.markDate, normalizeSlotTime(m.slotStart));
    dataKeys.add(key);
    const arr = marksByKey.get(key) ?? [];
    arr.push(m);
    marksByKey.set(key, arr);
  }
  for (const memoKey of input.slotMemoKeys) {
    const m = /^slot:(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(memoKey);
    if (m && dateSet.has(m[1])) dataKeys.add(slotKey(m[1], m[2]));
  }

  // 출석: 날짜별 학생 집합
  const attendanceByDate = new Map<string, Set<string>>();
  for (const a of input.attendance) {
    if (!dateSet.has(a.sessionDate)) continue;
    const set = attendanceByDate.get(a.sessionDate) ?? new Set<string>();
    set.add(a.studentId);
    attendanceByDate.set(a.sessionDate, set);
  }

  // 날짜별 eligible 학생(중복 enrollment은 "그 날짜에 active인 행 우선" 1개로 dedupe)
  function eligibleOn(date: string): Set<string> {
    const dow = dowKeyOf(date);
    const out = new Set<string>();
    for (const e of input.enrollments) {
      if (out.has(e.studentId)) continue;
      if (e.withdrawnAt && e.withdrawnAt < date) continue;
      if (!isEnrollmentActiveOn(
        { startDate: e.startDate, endDate: e.endDate, onHold: e.onHold, isTransferred: e.isTransferred },
        date,
      )) continue;
      if (!enrollmentAttendsOnDay(e.attendanceDays, dow)) continue;
      out.add(e.studentId);
    }
    return out;
  }

  const days: GridDay[] = [];
  const attendanceOnly: { date: string; studentIds: string[] }[] = [];

  for (const date of dates) {
    const dow = dowKeyOf(date);
    const slotStarts = new Set<string>();
    for (const key of scheduledByKey.keys()) if (key.startsWith(`${date}|`)) slotStarts.add(key.slice(11));
    for (const key of dataKeys) if (key.startsWith(`${date}|`)) slotStarts.add(key.slice(11));

    if (slotStarts.size === 0) {
      const att = attendanceByDate.get(date);
      if (att && att.size > 0) attendanceOnly.push({ date, studentIds: [...att].sort() });
      continue;
    }

    const eligible = eligibleOn(date);
    const attToday = attendanceByDate.get(date) ?? new Set<string>();

    const slots: GridSlot[] = [...slotStarts].sort().map((slot) => {
      const key = slotKey(date, slot);
      const sched = scheduledByKey.get(key) ?? null;
      const lines = (linesByKey.get(key) ?? [])
        .slice()
        .sort((a, b) => (TERM_ORDER[a.termMode] - TERM_ORDER[b.termMode]) || a.lineNo - b.lineNo);
      const markOwners = new Set((marksByKey.get(key) ?? []).map((m) => m.studentId));
      // 로스터 합집합: eligible ∪ 슬롯 마크 보유 ∪ 그 날짜 출석 보유
      const ids = new Set<string>([...eligible, ...markOwners, ...attToday]);
      const roster: RosterEntry[] = [...ids].sort().map((studentId) => ({
        studentId,
        eligible: eligible.has(studentId),
        historical: !eligible.has(studentId),
      }));
      return {
        slotStart: slot,
        slotEnd: sched ? normalizeSlotTime(sched.endTime) : null,
        scheduled: sched !== null,
        teacherId: sched?.teacherId ?? null,
        teacherLabel: sched?.slotTeacherLabel ?? null,
        roomLabel: sched?.slotRoomLabel ?? null,
        lines,
        roster,
      };
    });

    days.push({ date, dow, slots });
  }

  return { weekMonday: input.weekMonday, days, attendanceOnly };
}

/**
 * 작성률 — 분모 = 그 주 **스케줄된** 교시 수(고아 슬롯 제외 — 별도 경고 표시), 분자 = '의미 있는 행' ≥ 1개인
 * 스케줄 교시 수. placeholder-only 슬롯은 미작성으로 센다.
 */
export function sheetFillStats(grid: WeekGrid): {
  totalSlots: number;
  filledSlots: number;
  orphanSlots: number;
} {
  let total = 0;
  let filled = 0;
  let orphan = 0;
  for (const day of grid.days) {
    for (const slot of day.slots) {
      if (!slot.scheduled) {
        orphan += 1;
        continue;
      }
      total += 1;
      const meaningful = slot.lines.some((l) =>
        isMeaningfulPlanLine({
          textbook: l.textbook,
          pageRange: l.pageRange,
          progress: l.progress,
          homework: l.homework,
        }),
      );
      if (meaningful) filled += 1;
    }
  }
  return { totalSlots: total, filledSlots: filled, orphanSlots: orphan };
}
