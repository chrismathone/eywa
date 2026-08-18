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
//  · 자리(LAB·JJ): 판정은 `hiddenSeatOf` 하나 — **LAB은 항상 제외**(전용 출석부로 이관 예정, 원장
//    2026-08-06)이고 상단 토글이 정하는 건 **JJ뿐**이다. 안 그린 자리에 기록이 남아 있으면 `hiddenSpecial`에
//    자리별 건수로 알린다(조용히 사라지면 "쓴 게 증발했다"가 된다 — 07-31에 실제로 밟은 함정).
//    같은 시각에 강사 수업이 겹치면 수업이 이긴다(자리를 빼면서 실수업까지 사라지지 않게).
import {
  isEnrollmentActiveOn,
  isEnrollmentEndedOn,
  enrollmentAttendsOnDay,
} from "@/features/enrollments/eligibility";
import { shiftDays } from "@/features/timetable/lib/week";
import {
  LAB_ROOM_LABEL,
  SPECIAL_SLOT_LABELS,
  specialSlotLabel,
  type SpecialSlotLabel,
} from "@/features/timetable/lib/teacher-label";
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
  /**
   * enrollments.withdrawal_reason — **반 단위** 종료 사유(원본 그대로. 표시는 소비처가
   * `reasonDisplay`로 한글화한다 — 표준 코드(other·schedule…)를 화면에 흘리지 않기 위해).
   */
  withdrawalReason?: string | null;
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
  /**
   * 그 종료를 만든 enrollment의 사유(원본) — '퇴원' 섹션 한 줄 요약의 괄호에 들어간다.
   * null이면 괄호에서 사유를 통째로 뺀다(빈 괄호 금지 — 원장 2026-08-18).
   */
  endedReason?: string | null;
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
   * 안 그린 자리 교시 중 **기록이 남아 있는** 것의 건수 — 화면 하단 각주용, **자리별로 나눠** 담는다.
   * "여기 쓴 게 있었는데 화면엔 없다"를 **침묵하지 않기 위한** 숫자다(빈 배열이면 아무것도 표시하지 않는다).
   *
   * ⚠️ 자리별로 나누는 이유 = **되돌리는 방법이 다르다.** JJ는 상단 토글로 다시 볼 수 있지만 LAB은
   *    화면에서 되돌릴 길이 없다(항상 제외) — 한 문장으로 뭉치면 둘 중 한쪽이 반드시 거짓말이 된다.
   */
  hiddenSpecial: HiddenSeatCount[];
};

/** 안 그린 자리 하나의 기록 요약(기록이 0건인 자리는 담지 않는다). */
export type HiddenSeatCount = { seat: SpecialSlotLabel; slots: number; records: number };

function slotKey(date: string, slot: string): string {
  return `${date}|${slot}`;
}

/**
 * 이 슬롯을 ECS에서 **안 그린다면** 그 자리 이름, 그린다면 null — 화면·작성률 분모·각주가 공유하는 단일 판정.
 *
 * 🔴 **LAB은 설정과 무관하게 언제나 제외**한다. 원장 2026-08-06: *"ecs에서 lab은 전용 출석부를 만들 예정이라
 *    LAB은 빼버릴 것."* 그래서 상단 토글이 정하는 건 **JJ(집중자율수업실)뿐**이다.
 * ⚠️ LAB엔 실기록이 남아 있다(2026-08-06 실측: 최근 90일 계획 67행·마크 306건). 빼는 건 원장 지시지만
 *    **건수는 반드시 각주로 알린다**(`hiddenSpecial`) — 화면에서 지우는 것과 DB에서 지우는 건 다르고,
 *    전용 출석부가 생기기 전까지 그 기록을 볼 곳이 없다는 사실을 사람이 알아야 한다.
 * ⚠️ 자리 판정 자체(`specialSlotLabel`)는 손대지 않는다 — 라벨 원문·권한(FK)은 불변(teacher-label.ts 🔴).
 */
export function hiddenSeatOf(
  slotTeacherLabel: string | null | undefined,
  includeSelfStudy: boolean,
): SpecialSlotLabel | null {
  const seat = specialSlotLabel(slotTeacherLabel);
  if (seat === null) return null;
  if (seat === LAB_ROOM_LABEL) return seat; // 항상 제외(토글 대상 아님)
  return includeSelfStudy ? null : seat;
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
  /** JJ 교시를 분모에 넣을지 — 시트 화면과 **같은 값**을 넘긴다(보이는 교시 = 세는 교시). LAB은 항상 제외. */
  opts: { includeSelfStudy?: boolean } = {},
): Set<string> {
  const includeSelfStudy = opts.includeSelfStudy ?? true;
  const out = new Set<string>();
  for (const date of weekDatesOf(weekMonday)) {
    const dow = dowKeyOf(date);
    for (const s of schedules) {
      if (s.dayOfWeek !== dow) continue;
      if (s.validFrom > date) continue;
      if (s.validTo && s.validTo < date) continue;
      // 안 그리는 자리는 분모에서도 뺀다 — 화면에서 뺀 교시를 분모에 남기면 작성률이 영영 100%에 못 닿는다.
      // 같은 시각에 진짜 강사 슬롯이 겹치면 그쪽이 키를 넣으므로 수업은 그대로 세어진다.
      if (hiddenSeatOf(s.slotTeacherLabel, includeSelfStudy)) continue;
      out.add(slotKey(date, normalizeSlotTime(s.startTime)));
    }
  }
  return out;
}

/**
 * 유닛(시수) 세는 법 — **프로그램마다 다르다**(원장 2026-08-06).
 *  · `periods`(EiE) — *"eie는 유닛카운트라 1을 40분 단위로 체크하면 된다. 3은 2시간이 되는 것."*
 *    → 그 날 **교시 수**가 곧 유닛. 실측상 EiE 배치는 40분(73행)·30분(10행)로 균일해 교시=유닛이 성립한다.
 *  · `hours`(인재원 영어·미분류) — *"인재원 수업의 경우 1을 1시간이라 생각하면 되고."*
 *    → 그 날 **총 수업 분 ÷ 60**. 인재원 배치는 50·60·40·20분이 섞여 있어(실측) 교시 수로 세면
 *      같은 1유닛이 40분이었다 60분이었다 한다 — 길이로 재야 "1 = 1시간"이 지켜진다.
 *
 * 🔴 두 트랙을 한 규칙으로 뭉치지 말 것. 인재원을 교시 수로 세면 50분 2교시(=1.7시간)가 2유닛이 되어
 *    시수·급여가 부풀고, EiE를 시간으로 재면 40분 3교시(=2시간)가 2유닛이 되어 원장이 말한 3과 어긋난다.
 * ⚠️ 미분류(null)는 **인재원과 같이** 취급한다 — `english-track.ts`의 비대칭 규약 그대로(EiE만 정확 일치).
 */
export type UnitCountMode = "periods" | "hours";

/**
 * 날짜별 **유닛(시수) 자동값** — ECS 출결을 *처음 찍을 때* 넣는 기본값.
 *
 * 배경: `attendance_records`는 **(학생,반,날짜) 한 행**인데 영어는 하루 2~4교시인 반이 흔하다. 그냥 두면
 * 4교시 수업이 1유닛으로 잡힌다(실측: 영어 출결 전건 units=1).
 *
 * 🔴 **표시 설정(JJ 토글)과 무관해야 한다.** 화면에 보이는 교시로 세면 *보기 설정이 급여를 바꾼다.*
 *    그래서 `hiddenSeatOf`가 아니라 `specialSlotLabel`로 자리(LAB·JJ)를 **언제나** 뺀다 — 자리는 담당
 *    강사가 없는 방(teacher_id=null)이라 강사의 수업 시수가 아니다.
 * ⚠️ 같은 시각이 두 번 있으면(자리와 겹침 등) 한 번만 센다. 자리는 위에서 이미 빠진다.
 * ⚠️ 기본값 1과 같은 날은 **키를 안 만든다** — 굳이 1을 써 넣으면 0169a 취소 가드가 걸리는 것도 없고
 *    저장 규약(`parseSessionUnits`가 1을 null로 정규화)과도 어긋나지 않는다.
 */
export function scheduledUnitsByDate(
  weekMonday: string,
  schedules: readonly Pick<
    GridScheduleRow,
    "dayOfWeek" | "startTime" | "endTime" | "validFrom" | "validTo" | "slotTeacherLabel"
  >[],
  mode: UnitCountMode,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const date of weekDatesOf(weekMonday)) {
    const dow = dowKeyOf(date);
    const byStart = new Map<string, number>(); // 시각 → 분(중복 시각은 한 번만)
    for (const s of schedules) {
      if (s.dayOfWeek !== dow) continue;
      if (s.validFrom > date) continue;
      if (s.validTo && s.validTo < date) continue;
      if (specialSlotLabel(s.slotTeacherLabel)) continue; // 자리는 수업 시수가 아니다
      const start = normalizeSlotTime(s.startTime);
      if (byStart.has(start)) continue;
      byStart.set(start, slotMinutes(start, normalizeSlotTime(s.endTime)));
    }
    if (byStart.size === 0) continue;
    const raw =
      mode === "periods"
        ? byStart.size
        : [...byStart.values()].reduce((sum, m) => sum + m, 0) / 60;
    // 저장 규약과 같은 반올림(소수 한 자리). 1이면 기본값이라 키를 안 남긴다.
    const units = Math.round(raw * 10) / 10;
    if (units > 0 && units !== 1) out[date] = units;
  }
  return out;
}

/** "HH:MM" 두 개의 분 차이(음수·비정상은 0 — 시수를 지어내지 않는다). */
function slotMinutes(start: string, end: string): number {
  const toMin = (v: string) => {
    const [h, m] = v.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const diff = toMin(end) - toMin(start);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

/**
 * 그 주의 **자리(LAB·JJ) 슬롯 키** 집합 — 랜딩이 "고아(시간 변경됨)"를 셀 때 빼기 위한 것.
 *
 * 🔴 자리 교시는 스케줄에 **있다**. 우리가 화면에서 안 그릴 뿐이다. 그래서 `scheduledSlotKeySet`에서
 *    빠지는데, 그걸 그대로 "스케줄에 없는 기록 = 고아"로 세면 LAB에 남은 계획이 통째로
 *    *"시간 변경된 기록 N건"* 으로 둔갑한다(같은 데이터를 시트 상세는 'LAB 각주'라 부른다).
 * ⚠️ 표시 설정과 무관하게 **자리면 전부** 담는다 — JJ를 켜 둔 계정에선 JJ 키가 `scheduled`에도 있어
 *    어차피 고아 판정에 안 걸리므로, 여기서 굳이 토글을 볼 이유가 없다(볼수록 갈릴 여지만 는다).
 */
export function seatSlotKeySet(
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
      if (!specialSlotLabel(s.slotTeacherLabel)) continue;
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
  /**
   * **JJ** 교시를 그릴지 — 계정 설정([`view-prefs.ts`](../view-prefs.ts) `showSelfStudy`, 기본 표시).
   * 끄면 슬롯에서 빠지고 작성률 분모에서도 빠진다(보이는 교시 = 세는 교시).
   * ⚠️ LAB은 이 값과 무관하게 **항상 제외**된다(`hiddenSeatOf` 참조) — 켠다고 다시 나오지 않는다.
   */
  includeSelfStudy?: boolean;
  /**
   * **플래그 없는 반 이동 전출자**(원장 2026-08-18 *"이런 건 퇴원처리 안 되어 있게 · 반이동이 제대로"*) —
   * 학원 퇴원이 아닌데 이 반 수강이 끝났고 **같은 과목 다른 반에 열린 수강**이 있는 학생 id 집합.
   * 옛 반 종료+새 반 배정을 따로 하면(시트 동기·수강 종료+배정 수작업) `is_transferred`가 안 남아
   * '퇴원' 줄에 잘못 선다 — 이 집합에 있으면 전출로 보고 퇴원 줄에서 뺀다(새 반 로스터에 보인다).
   * 집합 산출은 서버(queries.ts) — 같은 과목 한정(다른 과목만 남은 학생은 이 과목에선 진짜 그만둔 것).
   */
  activeElsewhereSameSubject?: readonly string[];
}): WeekGrid {
  const includeSelfStudy = input.includeSelfStudy ?? true;
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
  const movedElsewhere = new Set(input.activeElsewhereSameSubject ?? []);

  /**
   * 날짜별 로스터 상태 — eligible(그 날 수강 대상) + endedOn(퇴원 유예 내 종료일).
   * 중복 enrollment(재등록·분리등원 분할)은 학생 1행으로 접는다: **열린 수강이 하나라도 있으면 재원**,
   * 전부 끝났으면 가장 **최근** 종료일을 퇴원일로 쓴다(시간표 셀의 재원>퇴원 우선순위와 같은 규약).
   */
  function rosterStateOn(date: string): {
    eligible: Set<string>;
    endedOn: Map<string, string>;
    endedReason: Map<string, string | null>;
  } {
    const dow = dowKeyOf(date);
    const eligible = new Set<string>();
    const endedOn = new Map<string, string>();
    // 사유는 **그 종료일을 만든 enrollment의 것**이다(반마다 사유가 달라 endedOn과 반드시 같은 행에서 온다).
    const endedReason = new Map<string, string | null>();
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
      // 플래그 없는 전출(같은 과목 다른 반에 열린 수강) — 위와 같은 결. 단 학원 퇴원(withdrawn_at)은
      // 데이터가 어긋나도 예외 없이 표시한다(진짜 그만둔 학생을 숨기면 그게 더 큰 거짓이다).
      if (!withdrawn && movedElsewhere.has(e.studentId)) continue;
      // 실효 종료일 = 반 이탈(end_date)과 학생 퇴원(withdrawn_at) 중 **이른** 것(시간표와 같은 산식).
      const effectiveEnd = [e.endDate, e.withdrawnAt].filter((x): x is string => !!x).sort()[0];
      if (!effectiveEnd) continue;
      if (effectiveEnd < withdrawnFloor) continue; // 유예(30일)가 지난 종료는 표시하지 않는다
      const prev = endedOn.get(e.studentId);
      if (!prev || prev < effectiveEnd) {
        endedOn.set(e.studentId, effectiveEnd);
        endedReason.set(e.studentId, e.withdrawalReason ?? null);
      }
    }
    for (const id of eligible) {
      endedOn.delete(id); // 재등록: 열린 수강이 있으면 퇴원이 아니다
      endedReason.delete(id);
    }
    return { eligible, endedOn, endedReason };
  }

  const days: GridDay[] = [];
  const attendanceOnly: { date: string; studentIds: string[] }[] = [];
  // 자리별 누계 — 되돌리는 방법이 자리마다 달라 한 덩어리로 못 센다(WeekGrid.hiddenSpecial 주석).
  const hiddenBySeat = new Map<SpecialSlotLabel, { slots: number; records: number }>();

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

    const { eligible, endedOn, endedReason } = rosterStateOn(date);
    const attToday = attendanceByDate.get(date) ?? new Set<string>();

    // 안 그릴 자리(LAB 항상 · JJ는 설정) — 판정은 hiddenSeatOf 단일 소스.
    // ⚠️ 안 그리면 그 자리에 남아 있는 계획·마크가 화면에서 사라진다(DB엔 그대로) → 아래에서 자리별로
    //    건수를 세어 각주에 남긴다. 조용히 사라지면 "쓴 게 증발했다"가 된다.
    const hiddenSeatAt = (slot: string) =>
      hiddenSeatOf(scheduledByKey.get(slotKey(date, slot))?.slotTeacherLabel ?? null, includeSelfStudy);
    for (const slot of slotStarts) {
      const seat = hiddenSeatAt(slot);
      if (!seat) continue;
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
        const cur = hiddenBySeat.get(seat) ?? { slots: 0, records: 0 };
        cur.slots += 1;
        cur.records += records;
        hiddenBySeat.set(seat, cur);
      }
    }

    const slots: GridSlot[] = [...slotStarts]
      .filter((slot) => !hiddenSeatAt(slot))
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
        endedReason: endedReason.get(studentId) ?? null,
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

  // 표시 순서 = SPECIAL_SLOT_LABELS(LAB → JJ) 고정 — Map 삽입순(요일 순회 결과)이면 주마다 문장이 뒤바뀐다.
  const hiddenSpecial: HiddenSeatCount[] = SPECIAL_SLOT_LABELS.flatMap((seat) => {
    const c = hiddenBySeat.get(seat);
    return c ? [{ seat, slots: c.slots, records: c.records }] : [];
  });

  return { weekMonday: input.weekMonday, days, attendanceOnly, hiddenSpecial };
}

/**
 * 작성률 — 분모 = 그 주 **스케줄된** 교시 수(고아 슬롯 제외 — 별도 경고 표시), 분자 = '의미 있는 행' ≥ 1개인
 * 스케줄 교시 수. placeholder-only 슬롯은 미작성으로 센다.
 * 자리는 `hiddenSeatOf`를 따른다 — 그린 자리만 분모에 들어가고, 안 그린 자리(LAB 항상·JJ 설정)는 애초에
 * `days`에 없어 빠진다. 랜딩 카드의 `scheduledSlotKeySet`에도 **같은 설정값**을 넘겨야 숫자가 안 갈린다.
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
