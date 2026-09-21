// 수학 출석 시수 **자동 기본값** — 순수 함수(Vitest). 서버 조회는 [`server/auto-units.ts`](./server/auto-units.ts).
//
// 원장 2026-09-11: *"월목 3시간 반이랑 수 3시간반 출석할때 출석부에 1로 입력된다는데 확인해봐. 1.5로 입력되어야
// 맞을 것 같은데"* → 선택지 답 **"그날 수업 길이로 자동"**. **수학 반 전체(특강 포함)** · **처음 찍을 때만** ·
// 강사가 고친 값은 그대로.
// 🔴 2026-09-14 정정(원장): **교시 하나 = 0.5 · 55분도 한 시간으로 올림**. 평일 교시는 1-1~4-2로 나뉘고 그 한 칸이
//    55분이다 — 그러니 2교시 = 1 · 3교시 = 1.5 · 1교시 = **0.5**. 09-11 구현의 반올림은 지시가 아니라 구현 선택이었다.
//
// 🔴 시수(`attendance_records.session_units`, null = 1)는 **돈**이다 — 급여 정산(settlement·tier-rows)과
//    청구 회차 소비(0115a 시수 검증)가 이 값을 읽는다. 그래서 규칙은 여기 **한 벌**뿐이고, 쓰기 경로 전부
//    (단건·일괄·범위·일별 폼·키오스크)가 서버 헬퍼 `resolveAutoUnits` 하나를 지난다(가드 auto-units-wiring.test.ts).
// 🔴 **새 행(INSERT)에만** 넣는다. 이미 있는 행을 고치는 저장은 종전 그대로다 — 강사가 고친 값·명시한 1을
//    자동값이 덮으면 "입력된 숫자가 입력되도록"(원장 2026-09-01)이 깨진다.
// ⚠️ 9월분 소급 보정은 `scripts/_oneoff/backfill-math-auto-units.mjs`(드라이런 기본) — 규칙은
//    `math-auto-units-rules.mjs`가 같은 식을 들고 있고 패리티 테스트가 두 벌이 갈리지 않게 잠근다.
// 영어는 english_track을 넘기는 경로에서만 환산한다. 2026-09-21 정정: 인재원은 60분당 1,
// EiE는 40분당 1이다. 수학의 60분당 0.5와 구분한다.

import { liveSlotMinutesOn } from "@/features/class-sheets/lib/grid";
import type { DowKey } from "@/features/class-sheets/lib/week";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import { COUNTABLE_STATUSES, MAX_SESSION_UNITS, isDefaultUnitsRaw } from "./session-units";

/** 수업 길이로 시수를 자동으로 채우는 과목 키. 새 과목을 넣기 전에 원장 확인(돈 규칙이다). */
export const AUTO_UNITS_SUBJECTS: ReadonlySet<string> = new Set(["math"]);

export type AutoUnitsTrack = "math" | "eie" | "injaewon";

export function isAutoUnitsSubject(subject: string | null | undefined): boolean {
  return !!subject && AUTO_UNITS_SUBJECTS.has(subject);
}

/**
 * 수학 기본값: 그날 수업 **분** → 시수 = **ceil(분 ÷ 60) ÷ 2** = 교시 하나당 0.5.
 * 영어 트랙을 지정하면 EiE는 40분당 1, 인재원은 60분당 1로 환산한다.
 * 55분 → 0.5 · 110·115·120(2교시) → 1 · 165(3교시) → 1.5 · 180(3시간) → 1.5 · 240 → 2.
 *
 * 🔴 **올림이다 — 55분 수업도 한 시간으로 센다**(원장 2026-09-14: *"55분 수업이여도 1시간으로 생각해야해.
 *    우리 수업시간에 1-1부터 4-2까지 나누어져있잖아 평일이. 그 하나당 0.5인거야"*).
 * ⚠️ 09-11 구현이 **반올림**이었던 것은 원장 지시가 아니라 구현 선택이었다(원장 2026-09-14
 *    *"반올림하라는 지시는 전혀 한적이 없는데"*). 반올림·내림 둘 다 교시 축과 어긋난다 — 교시가 곧 단위다.
 * 🔴 하한 1을 두지 않는다 — 1교시(55분)만 도는 날은 **0.5**다(하한이 있으면 그 날이 1로 부풀었다).
 * 1이면 **null**(기본값 — 굳이 적지 않는다. 저장 규약 `parseSessionUnits`가 1을 null로 접는 것과 같다).
 * 수업이 없으면(0분) null = 자동 안 함.
 */
export function unitsFromMinutes(minutes: number, track: AutoUnitsTrack = "math"): number | null {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const units =
    track === "eie"
      ? Math.min(MAX_SESSION_UNITS, Math.round((minutes / 40) * 2) / 2)
      : Math.min(MAX_SESSION_UNITS, Math.ceil(minutes / 60) / (track === "injaewon" ? 1 : 2));
  return units === 1 ? null : units;
}

/** 자동값 판정에 쓰는 배치 한 줄 — `class_schedules`의 필요한 칸만. */
export type AutoUnitsSchedule = {
  dayOfWeek: DowKey;
  startTime: string;
  endTime: string;
  validFrom: string;
  validTo: string | null;
  slotTeacherLabel: string | null;
  labSeparate?: boolean;
};

/** A 40-minute period on any weekday makes the active English timetable a bridge course. */
export function usesFortyMinuteEnglishUnits(
  date: string,
  schedules: readonly AutoUnitsSchedule[],
  englishTrack: string | null,
  className = "",
): boolean {
  if (englishTrack === "eie" || /브릿지|브리지|\bbridge\b/i.test(className)) return true;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  return schedules.some((s) => s.validFrom <= date && (!s.validTo || s.validTo >= date)
    && !isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate) && !/^\s*\*\s*LAB\b/i.test(s.slotTeacherLabel ?? "")
    && minutes(s.endTime) - minutes(s.startTime) === 40);
}

/** DB 행(snake) → 판정 모양. 서버 헬퍼·월별 출석부·원스크린 로스터가 **같은 변환**을 쓴다. */
export function toAutoUnitsSchedule(row: {
  day_of_week: string;
  start_time: string;
  end_time: string;
  valid_from: string;
  valid_to: string | null;
  slot_teacher_label: string | null;
  lab_separate?: boolean;
}): AutoUnitsSchedule {
  return {
    dayOfWeek: row.day_of_week as DowKey,
    startTime: row.start_time,
    endTime: row.end_time,
    validFrom: row.valid_from,
    validTo: row.valid_to ?? null,
    slotTeacherLabel: row.slot_teacher_label ?? null,
    ...(row.lab_separate === undefined ? {} : { labSeparate: row.lab_separate }),
  };
}

/**
 * 그 날짜 그 반의 자동 시수 — 그날 유효한 배치 중 **자리(LAB·JJ) 제외 · 같은 시작 시각은 한 번**으로 분을 더한다.
 * 분 계산은 ECS 유닛 자동값과 **같은 함수**(`liveSlotMinutesOn`)다. null = 자동 안 함(배치 없음·1).
 */
export function autoUnitsOn(
  date: string,
  schedules: readonly AutoUnitsSchedule[],
  track: AutoUnitsTrack = "math",
  className = "",
): number | null {
  let total = 0;
  for (const m of liveSlotMinutesOn(date, schedules).values()) total += m;
  const basis = track !== "math" && usesFortyMinuteEnglishUnits(date, schedules, track, className) ? "eie" : track;
  return unitsFromMinutes(total, basis);
}

/**
 * 이 저장이 자동값을 받을 수 있는가 — 셋 다 필요하다.
 *  ① 사람이 숫자를 **안 골랐다**(원문이 없거나 공백 — `isDefaultUnitsRaw`. "1"은 명시다)
 *  ② **그날 전체** 행이다(`slot_start` null — 교시별 행은 영어·자리의 축이라 대상이 아니다)
 *  ③ 시수를 **소비하는 상태**다(출석·지각·조퇴·보강 — 결석·공결엔 시수가 없다)
 * ⚠️ 과목·배치(수업 길이)는 서버가 본다(`resolveAutoUnits`) — 여기서 true여도 영어 반이면 값이 없다.
 * ⚠️ **새 행을 만들 때만** 부른다. 있는 행을 고치는 저장에 쓰지 말 것(강사가 고친 값을 덮는다).
 */
export function autoUnitsApply(input: {
  rawUnits: string | null | undefined;
  slotStart: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    isDefaultUnitsRaw(input.rawUnits) &&
    !input.slotStart &&
    !!input.status &&
    COUNTABLE_STATUSES.has(input.status)
  );
}

/** 새 행에 실을 시수와, 그중 **자동으로 들어간 값**. */
export type NewRowUnits = {
  /** 새 행 `session_units`(null = 1). */
  units: number | null;
  /**
   * 자동 판정을 탄 새 행이면 실제로 들어간 값(null = 1 — 대상 아님·조회 실패). 사람이 숫자를 골랐거나
   * 판정 밖(결석·교시별 행)이면 undefined. 호출부는 이 값으로 화면·감사로그를 **저장값과 같게** 맞춘다.
   */
  auto: number | null | undefined;
};

/**
 * 새 행의 시수 — 🔴 **사람이 친 숫자가 먼저다**(원장 2026-09-01 *"입력된 숫자가 입력되도록"*). 원문이
 * 없거나 공백일 때만 자동값(`auto`, `resolveAutoUnits`가 찾은 값 — 판정 밖이면 undefined)을 쓴다.
 * ⚠️ `autoUnitsApply`와 **따로** 원문을 다시 본다 — 원문을 보는 곳이 한 군데뿐이면 그 인자 하나가 바뀌는 순간
 *    친 "1"·"2"가 조용히 자동값으로 덮인다(적대 리뷰 2026-09-11: 인자 한 토큰 변이가 전 테스트를 통과했다).
 */
export function newRowUnits(
  rawUnits: string | null | undefined,
  explicit: number | null,
  auto: number | null | undefined,
): NewRowUnits {
  if (!isDefaultUnitsRaw(rawUnits) || auto === undefined) return { units: explicit, auto: undefined };
  return { units: auto, auto };
}

/** (반, 날짜) 조회 키. */
export function autoUnitsKey(classId: string, date: string): string {
  return `${classId}|${date}`;
}

/**
 * 칸 목록 → (반|날짜) → 자동 시수. 과목이 대상이 아니거나 값이 1이면 **키가 없다**(= 종전처럼 null 저장).
 * `subjectOf`에 없는 반(조회에서 빠진 반)도 키가 없다 — 모르는 반에 돈 값을 지어내지 않는다.
 */
export function planAutoUnits(
  cells: readonly { classId: string; date: string }[],
  subjectOf: ReadonlyMap<string, string | null>,
  schedulesOf: ReadonlyMap<string, readonly AutoUnitsSchedule[]>,
  trackOf: ReadonlyMap<string, AutoUnitsTrack | null> = new Map(),
  classNameOf: ReadonlyMap<string, string> = new Map(),
): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of cells) {
    const key = autoUnitsKey(c.classId, c.date);
    if (out.has(key)) continue;
    const track = trackOf.get(c.classId) ?? null;
    if (!isAutoUnitsSubject(subjectOf.get(c.classId)) && !track) continue;
    const units = autoUnitsOn(c.date, schedulesOf.get(c.classId) ?? [], track ?? "math", classNameOf.get(c.classId));
    if (units !== null) out.set(key, units);
  }
  return out;
}

/** 한 반의 여러 날짜 → 날짜 → 자동 시수(1·배치 없음은 키 없음). 월별 출석부가 격자 기본값으로 싣는다. */
export function autoUnitsByDate(
  dates: readonly string[],
  schedules: readonly AutoUnitsSchedule[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const date of dates) {
    const units = autoUnitsOn(date, schedules);
    if (units !== null) out[date] = units;
  }
  return out;
}

/**
 * 감사로그 metadata 조각 — 자동값이 **들어간 칸 수**와 값별 칸 수(`{ "1.5": 12 }`).
 * 아무 칸에도 안 들어갔으면 빈 객체(평시 행을 늘리지 않는다).
 */
export function autoUnitsLogFields(values: readonly number[]): {
  autoUnitsCells?: number;
  autoUnitsByValue?: Record<string, number>;
} {
  if (values.length === 0) return {};
  const byValue: Record<string, number> = {};
  for (const v of values) byValue[String(v)] = (byValue[String(v)] ?? 0) + 1;
  return { autoUnitsCells: values.length, autoUnitsByValue: byValue };
}
