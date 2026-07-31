// ECS 주간 그리드 조립 — 순수(Vitest). **실날짜별** 정확성이 계약이다(계획 v2.2 §E·§F):
//  · 슬롯 유효성: 각 날짜에 valid_from ≤ date ≤ valid_to 인 스케줄만 "그 날 수업"이다(주 대표일 1회 판정 금지
//    — 주중 시간표 변경 주에 옛/새 스케줄이 같은 주에 걸친다).
//  · 로스터: 날짜별 isEnrollmentActiveOn(입퇴반·반이동 반열림 규약) + 분리등원(attendance_days) +
//    students.withdrawn_at. 단 attendance_days/on_hold는 이력이 없어 **현재값 기준**(비보장 명시 — eywa 전
//    화면과 동일 한계).
//  · 퇴원 유예: 수강이 끝난 학생은 **그 주 기준 30일**까지 endedOn을 달고 로스터에 남는다(하단 '퇴원'
//    섹션 — 시간표 셀과 같은 창). 반이동 전출(is_transferred)은 새 반에서 보이므로 옛 반엔 안 남긴다.
//  · 과거 데이터 보존: 로스터 = eligible ∪ 퇴원 유예 ∪ 그 슬롯 mark 보유 ∪ 그 날짜 effective 출석 보유
//    (비eligible은 historical 읽기 전용). 스케줄 없는 날짜의 출석은 가짜 슬롯 없이 attendanceOnly로 분리.
//  · 고아 슬롯: 계획·마크·슬롯 메모가 있는데 그 날짜 스케줄에 없는 (date,slot) — 표시는 유지(소실 금지).
//  · 랩실(LAB·JJ): 담임 수업이 아니라 **아예 안 그린다**(원장 2026-07-31 확정). 기록이 남아 있으면 카드
//    대신 `hiddenSpecial` 건수로만 알린다. 같은 시각에 강사 수업이 겹치면 수업이 이긴다(실수업 보존).
import {
  isEnrollmentActiveOn,
  isEnrollmentEndedOn,
  enrollmentAttendsOnDay,
} from "@/features/enrollments/eligibility";
import { shiftDays } from "@/features/timetable/lib/week";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { isMeaningfulPlanLine } from "./plan-codec";
import { dowKeyOf, normalizeSlotTime, weekDatesOf, type DowKey } from "./week";

/**
 * 퇴원 표시 유예 — 수강이 끝난 학생을 **그 주 월요일 기준 30일**까지 로스터 하단 '퇴원' 섹션에 남긴다
 * (시간표 셀과 같은 창: [timetable/server/queries.ts](src/features/timetable/server/queries.ts) `withdrawnFloor`,
 * 2026-07-14 원장 1년→1달). 앵커가 **주 월요일**인 이유: 날짜별로 재면 같은 주 안에서 월요일엔 보이고
 * 금요일엔 사라져 한 주가 자기모순이 된다 — 창은 주 단위로 열고 닫혀야 "다음 주부터 사라진다"가 성립한다.
 */
export const WITHDRAWN_GRACE_DAYS = 30;

/** 그 주에 '퇴원'으로 표시할 종료일의 하한(이보다 이른 종료는 유예가 지나 표시하지 않는다). */
export function withdrawnFloorOf(weekMonday: string): string {
  return shiftDays(weekMonday, -WITHDRAWN_GRACE_DAYS);
}

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
  /** 비eligible인데 화면에 남는 행(퇴원 유예 또는 기록 보존) — 읽기 전용. */
  historical: boolean;
  /**
   * 수강 종료일(YYYY-MM-DD) — 값이 있으면 하단 **'퇴원' 섹션** 행이다(유예 30일 내 종료·퇴원).
   * 없는 비eligible 행은 '기록' 행(마크·출석만 남은 학생 — 유예가 지났거나 이 반 수강 기록 자체가 없음).
   */
  endedOn?: string | null;
};

export type GridSlot = {
  slotStart: string; // "HH:MM"
  slotEnd: string | null; // 고아 슬롯은 null
  /** 그 날짜에 유효한 스케줄이 실재하는가. false=고아(시간 변경됨 — 데이터만 남음). */
  scheduled: boolean;
  teacherId: string | null;
  // slot_teacher_label을 **해석기(resolveTeacherLabel)를 통과시킨 표시명** — 로더(queries.ts)가 이미
  // 변환해 넣는다(영문 닉네임→한글 이름, 이주희/JJ→LAB). 소비처는 그대로 그리면 된다.
  // ⚠️ 원문이 아니므로 이 값을 권한·매칭 근거로 쓰지 말 것(게이트는 teacher_id FK만 — access.ts).
  teacherLabel: string | null;
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
  /**
   * 안 그린 자리(LAB·JJ) 교시 중 **기록이 남아 있는** 것의 건수 — 화면 하단 각주용.
   * 카드를 되살리려는 게 아니라 "여기 쓴 게 있었는데 화면엔 없다"를 **침묵하지 않기 위한** 숫자다
   * (0이면 아무것도 표시하지 않는다).
   */
  hiddenSpecial: { slots: number; records: number };
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
  schedules: readonly Pick<
    GridScheduleRow,
    "dayOfWeek" | "startTime" | "validFrom" | "validTo" | "slotTeacherLabel"
  >[],
): Set<string> {
  const out = new Set<string>();
  for (const date of weekDatesOf(weekMonday)) {
    const dow = dowKeyOf(date);
    for (const s of schedules) {
      if (s.dayOfWeek !== dow) continue;
      if (s.validFrom > date) continue;
      if (s.validTo && s.validTo < date) continue;
      // 자리(LAB·JJ)는 '작성해야 할 교시'가 아니다 — 분모에 넣으면 작성률이 영영 100%에 못 닿는다.
      // 같은 시각에 진짜 강사 슬롯이 겹치면 그쪽이 키를 넣으므로 수업은 그대로 세어진다.
      if (specialSlotLabel(s.slotTeacherLabel)) continue;
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
      const cur = scheduledByKey.get(key);
      // 같은 (날짜,시각)에 자리(LAB·JJ)와 강사 수업이 겹치면 **수업이 이긴다** — 자리로 뽑히면
      // 그 교시가 작성률에서 빠지고 비어 있을 때 화면에서도 사라진다(실수업이 증발).
      if (!cur || (specialSlotLabel(cur.slotTeacherLabel) && !specialSlotLabel(s.slotTeacherLabel))) {
        scheduledByKey.set(key, s);
      }
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
  const memoSlotKeys = new Set<string>();
  for (const memoKey of input.slotMemoKeys) {
    const m = /^slot:(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2})$/.exec(memoKey);
    if (m && dateSet.has(m[1])) {
      dataKeys.add(slotKey(m[1], m[2]));
      memoSlotKeys.add(slotKey(m[1], m[2]));
    }
  }

  // 출석: 날짜별 학생 집합
  const attendanceByDate = new Map<string, Set<string>>();
  for (const a of input.attendance) {
    if (!dateSet.has(a.sessionDate)) continue;
    const set = attendanceByDate.get(a.sessionDate) ?? new Set<string>();
    set.add(a.studentId);
    attendanceByDate.set(a.sessionDate, set);
  }

  const withdrawnFloor = withdrawnFloorOf(input.weekMonday);

  /**
   * 날짜별 로스터 상태 — eligible(그 날 수강 대상) + endedOn(퇴원 유예 내 종료일).
   * 중복 enrollment(재등록·분리등원 분할)은 학생 1행으로 접는다: **열린 수강이 하나라도 있으면 재원**,
   * 전부 끝났으면 가장 **최근** 종료일을 퇴원일로 쓴다(시간표 셀의 재원>퇴원 우선순위와 같은 규약).
   */
  function rosterStateOn(date: string): { eligible: Set<string>; endedOn: Map<string, string> } {
    const dow = dowKeyOf(date);
    const eligible = new Set<string>();
    const endedOn = new Map<string, string>();
    for (const e of input.enrollments) {
      const attendsToday = enrollmentAttendsOnDay(e.attendanceDays, dow);
      const withdrawn = !!e.withdrawnAt && e.withdrawnAt < date;
      const active =
        !withdrawn &&
        attendsToday &&
        isEnrollmentActiveOn(
          { startDate: e.startDate, endDate: e.endDate, onHold: e.onHold, isTransferred: e.isTransferred },
          date,
        );
      if (active) {
        eligible.add(e.studentId);
        continue;
      }
      // 여기부터 '퇴원(수강 종료)' 판정 — 대기(on_hold)·미시작·분리등원 비등원일은 종료가 아니다.
      // 안 오던 요일에까지 퇴원을 띄우면 "이 교시에 오던 학생이 그만뒀다"는 의미가 흐려진다.
      if (!attendsToday) continue;
      if (!(withdrawn || isEnrollmentEndedOn(e.endDate, date, e.isTransferred))) continue;
      // 반이동 전출은 새 반 로스터에서 보인다 — 옛 반에 퇴원으로 남기면 같은 학생이 두 번 보인다.
      if (e.isTransferred) continue;
      // 실효 종료일 = 반 이탈(end_date)과 학생 퇴원(withdrawn_at) 중 **이른** 것(시간표와 같은 산식).
      const effectiveEnd = [e.endDate, e.withdrawnAt].filter((x): x is string => !!x).sort()[0];
      if (!effectiveEnd) continue;
      if (effectiveEnd < withdrawnFloor) continue; // 유예(30일)가 지난 종료는 표시하지 않는다
      const prev = endedOn.get(e.studentId);
      if (!prev || prev < effectiveEnd) endedOn.set(e.studentId, effectiveEnd);
    }
    for (const id of eligible) endedOn.delete(id); // 재등록: 열린 수강이 있으면 퇴원이 아니다
    return { eligible, endedOn };
  }

  const days: GridDay[] = [];
  const attendanceOnly: { date: string; studentIds: string[] }[] = [];
  const hiddenSpecial = { slots: 0, records: 0 };

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

    const { eligible, endedOn } = rosterStateOn(date);
    const attToday = attendanceByDate.get(date) ?? new Set<string>();

    // 자리(LAB·JJ) 교시는 **그리지 않는다** — 랩·자율실은 담임(강사) 수업이 아니다(원장 2026-07-31 확정:
    // "실제 담임이 아닌 랩실(LAB 및 JJ)은 숨겨"). 기록이 있어도 예외를 두지 않는다.
    // ⚠️ 그래서 그 자리에 남아 있는 계획·마크는 화면에서 안 보인다(DB엔 그대로). 아래 hiddenSpecial로
    //    건수만 각주에 남긴다 — 조용히 사라지면 "쓴 게 증발했다"가 된다.
    const isSpecialStart = (slot: string) =>
      specialSlotLabel(scheduledByKey.get(slotKey(date, slot))?.slotTeacherLabel ?? null) != null;
    for (const slot of slotStarts) {
      if (!isSpecialStart(slot)) continue;
      const key = slotKey(date, slot);
      const records =
        (linesByKey.get(key) ?? []).filter((l) =>
          isMeaningfulPlanLine({
            textbook: l.textbook,
            pageRange: l.pageRange,
            progress: l.progress,
            homework: l.homework,
          }),
        ).length +
        (marksByKey.get(key)?.length ?? 0) +
        (memoSlotKeys.has(key) ? 1 : 0);
      if (records > 0) {
        hiddenSpecial.slots += 1;
        hiddenSpecial.records += records;
      }
    }

    const slots: GridSlot[] = [...slotStarts]
      .filter((slot) => !isSpecialStart(slot))
      .sort()
      .map((slot) => {
      const key = slotKey(date, slot);
      const sched = scheduledByKey.get(key) ?? null;
      const lines = (linesByKey.get(key) ?? [])
        .slice()
        .sort((a, b) => (TERM_ORDER[a.termMode] - TERM_ORDER[b.termMode]) || a.lineNo - b.lineNo);
      const markOwners = new Set((marksByKey.get(key) ?? []).map((m) => m.studentId));
      // 로스터 합집합: eligible ∪ 퇴원 유예 ∪ 슬롯 마크 보유 ∪ 그 날짜 출석 보유
      const ids = new Set<string>([...eligible, ...endedOn.keys(), ...markOwners, ...attToday]);
      // 표시 순서는 소비처(roster-order.ts)가 이름·종료일로 정한다 — 여기선 id 순으로 안정 정렬만.
      const roster: RosterEntry[] = [...ids].sort().map((studentId) => ({
        studentId,
        eligible: eligible.has(studentId),
        historical: !eligible.has(studentId),
        endedOn: endedOn.get(studentId) ?? null,
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

    if (slots.length === 0) {
      // 그 날 남은 게 없으면(자리 교시뿐이었다) 날짜 자체를 만들지 않는다 — 빈 요일 카드 방지.
      // 출석만 있으면 가짜 슬롯 대신 attendanceOnly로.
      const att = attendanceByDate.get(date);
      if (att && att.size > 0) attendanceOnly.push({ date, studentIds: [...att].sort() });
      continue;
    }

    days.push({ date, dow, slots });
  }

  return { weekMonday: input.weekMonday, days, attendanceOnly, hiddenSpecial };
}

/**
 * 작성률 — 분모 = 그 주 **스케줄된** 교시 수(고아 슬롯 제외 — 별도 경고 표시), 분자 = '의미 있는 행' ≥ 1개인
 * 스케줄 교시 수. placeholder-only 슬롯은 미작성으로 센다.
 * 자리(LAB·JJ)는 애초에 `days`에 없다(buildWeekGrid가 안 그린다) → 분모·분자 어디에도 안 들어간다.
 * 랜딩 카드의 `scheduledSlotKeySet`도 같은 규칙으로 걸러 두 화면의 숫자가 갈리지 않는다.
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
