// 교시(periodId) ↔ 절대시각 변환 + 요일 한글↔enum 변환 — 순수 함수.
// ijw `components/Timetable/constants.ts`의 PERIOD_INFO를 aywa로 이식.
// aywa는 DB에 절대시각(start_time/end_time)만 저장하므로, 이 변환은 엑셀 import 어댑터(Phase 3)가
// periodId→시각으로 1회 적용하는 데 쓰인다. periodLabel은 표시 전용.
//
// 평일: 과목별 교시표. math/highmath/science/korean = 8교시 55분(동일), english = 11교시.
// 주말(토·일): 09:00부터 1시간 단위 8교시(과목 무관).

import { buildPeriodMatcher } from "./period-match";

export type TimetableSubject = "math" | "highmath" | "english" | "science" | "korean";
// day_of_week enum(mon..sun)을 미러. DB 결합을 피하려 로컬 정의.
export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PeriodTime {
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  /**
   * 학원설정에서 학원장이 지은 교시 이름(예 "EiE 1교시"·"IJW 3교시"). **내장 기본표엔 없다**
   * → 소비처는 없으면(undefined) 교시 번호로 폴백한다. 이름은 표시 전용이고 식별자는 여전히 periodId(index+1).
   * ⚠️ **빈 문자열은 undefined와 다르다** — 학원장이 이름을 비운 것("시간대만 표시")이라 번호로 폴백하지
   *    않는다(2026-08-13). 판정은 [periodListLabel] 한 곳에서만 한다.
   */
  label?: string;
}

const KO_DAYS = ["월", "화", "수", "목", "금", "토", "일"] as const;
const ENUM_DAYS: DayOfWeek[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const KO_TO_ENUM: Record<string, DayOfWeek> = Object.fromEntries(
  KO_DAYS.map((ko, i) => [ko, ENUM_DAYS[i]]),
);
const ENUM_TO_KO: Record<DayOfWeek, string> = Object.fromEntries(
  ENUM_DAYS.map((d, i) => [d, KO_DAYS[i]]),
) as Record<DayOfWeek, string>;

/** 한글 요일("월")→enum("mon"). 알 수 없으면 null. */
export function koDayToEnum(ko: string): DayOfWeek | null {
  return KO_TO_ENUM[ko.trim()] ?? null;
}

/** enum 요일("mon")→한글("월"). */
export function enumDayToKo(day: DayOfWeek): string {
  return ENUM_TO_KO[day] ?? day;
}

export function isWeekendDay(day: DayOfWeek): boolean {
  return day === "sat" || day === "sun";
}

// 레거시 periodId('1-1'..'4-2')→통일('1'..'8'). 이미 통일이면 그대로.
const LEGACY_TO_UNIFIED: Record<string, string> = {
  "1-1": "1",
  "1-2": "2",
  "2-1": "3",
  "2-2": "4",
  "3-1": "5",
  "3-2": "6",
  "4-1": "7",
  "4-2": "8",
};

/** 레거시 키('1-1')를 통일 periodId('1')로 정규화. */
export function normalizePeriodId(raw: string): string {
  const key = String(raw).trim();
  return LEGACY_TO_UNIFIED[key] ?? key;
}

// 평일 교시표 — math/highmath/science/korean 공용(8교시, 55분).
const MATH_PERIODS: Record<string, PeriodTime> = {
  "1": { startTime: "14:30", endTime: "15:25" },
  "2": { startTime: "15:25", endTime: "16:20" },
  "3": { startTime: "16:20", endTime: "17:15" },
  "4": { startTime: "17:15", endTime: "18:10" },
  "5": { startTime: "18:20", endTime: "19:15" },
  "6": { startTime: "19:15", endTime: "20:10" },
  "7": { startTime: "20:10", endTime: "21:05" },
  "8": { startTime: "21:05", endTime: "22:00" },
};

// 영어 교시표(11교시) — 진실원본 = **통합영어시간표(7월)** 시트 col A 시각.
// ⚠️ 강사별영어시간표는 10분 단위로 쪼개 놓은 것(시작시각 일치 시 통합에 수식 출력)이라 교시 기준이 아님.
// 오후 16:20~17:40 구간은 40분·60분 두 수업 체계가 공존해 4~7교시 시간대가 일부 겹침(시트 실제 구조).
// 끝시각은 통합 col A의 시작시각별 최빈값(예 16:20 시작은 →17:00이 다수, →17:20 60분반은 소수).
// 과목별 커스텀(operations.subjects[].weekdayPeriods) 미설정 시의 영어 폴백.
const ENGLISH_PERIODS: Record<string, PeriodTime> = {
  "1": { startTime: "14:20", endTime: "15:00" },
  "2": { startTime: "15:00", endTime: "15:40" },
  "3": { startTime: "15:40", endTime: "16:20" },
  "4": { startTime: "16:20", endTime: "17:00" },
  "5": { startTime: "17:00", endTime: "17:40" },
  "6": { startTime: "17:20", endTime: "18:10" },
  "7": { startTime: "17:40", endTime: "18:20" },
  "8": { startTime: "18:20", endTime: "19:20" },
  "9": { startTime: "19:20", endTime: "20:10" },
  "10": { startTime: "20:20", endTime: "21:10" },
  "11": { startTime: "21:10", endTime: "22:00" },
};

/** 영어 11교시를 설정 편집기 행 형태로 — 학원설정 기본값(defaults.ts)이 소비(과목별 평일 교시 프리필). */
export const ENGLISH_WEEKDAY_PERIOD_LIST: { label: string; startTime: string; endTime: string }[] =
  Object.entries(ENGLISH_PERIODS).map(([id, t]) => ({
    label: `${id}교시`,
    startTime: t.startTime,
    endTime: t.endTime,
  }));

// 주말 교시표(과목 무관, 09:00부터 1시간 단위 8교시).
const WEEKEND_PERIODS: Record<string, PeriodTime> = {
  "1": { startTime: "09:00", endTime: "10:00" },
  "2": { startTime: "10:00", endTime: "11:00" },
  "3": { startTime: "11:00", endTime: "12:00" },
  "4": { startTime: "12:00", endTime: "13:00" },
  "5": { startTime: "13:00", endTime: "14:00" },
  "6": { startTime: "14:00", endTime: "15:00" },
  "7": { startTime: "15:00", endTime: "16:00" },
  "8": { startTime: "16:00", endTime: "17:00" },
};

// ── 설정 주입(config) — 평일/주말 교시표를 테넌트 설정(owner)으로 대체 가능. ──
// 미지정 시 DEFAULT_PERIODS_CONFIG(=현 상수)로 폴백 → 설정 없으면 오늘과 동일 동작.
// 평일 교시는 **과목별 override**(operations.subjects[].weekdayPeriods) 가능 — 미설정 과목은
// english=ENGLISH_PERIODS, 그 외=전역 weekday 폴백(2026-07-06, 옛 "영어 하드코딩" KNOWN_EXCEPTION 해소).
export interface PeriodsConfig {
  weekday: Record<string, PeriodTime>; // periodId "1".."N" → 시각 (과목 전용 미설정 시 기본)
  weekend: Record<string, PeriodTime>;
  /** 과목키 → 평일 교시표 override. plain Record(클라 직렬화 — Map 금지). 없으면 위 폴백. */
  weekdayBySubject?: Record<string, Record<string, PeriodTime>>;
  /**
   * **교시마다 한 행**(새 학원 일반판, 학원설정 `operations.periodStyle: "plain"`) — 모든 과목이 제 교시표를 한 줄씩 쓴다.
   * 없거나 false면 첫 학원(침산) 방식: 영어가 아닌 과목은 두 교시를 한 교시로 묶고(1-1·1-2), 영어는 내장 11교시로 폴백.
   * 🔴 침산은 이 키가 없다(settingsToPeriodsConfig가 plain일 때만 싣는다) — 침산 시간표는 이 작업 전과 같다.
   */
  plain?: boolean;
}

/**
 * 이 과목의 평일 교시를 **한 줄씩**(묶음 없이) 그리는가 — 영어이거나, 학원이 일반판 교시 방식(plain)일 때.
 * 묶음·반교시 라벨(1-1·1-2)·'완교시' 판정은 이 값이 false인 과목(침산의 수학 계열)에만 있다.
 */
export function isPerPeriodSubject(subject: string, config: PeriodsConfig): boolean {
  return subject === "english" || config.plain === true;
}

export const DEFAULT_PERIODS_CONFIG: PeriodsConfig = {
  weekday: MATH_PERIODS,
  weekend: WEEKEND_PERIODS,
};

/** 설정 화면(owner)의 교시 한 줄 — label은 학원설정 스키마에선 필수지만 옛 저장분·내장표를 위해 optional. */
type PeriodRowSetting = { startTime: string; endTime: string; label?: string };

/**
 * 설정(operations)의 교시 배열 → PeriodsConfig. 배열 index+1 = periodId 규약. 빈 배열이면 기본 상수.
 * subjects[].weekdayPeriods(길이>0)는 weekdayBySubject로 — 빈 배열=미설정 관례 동일.
 */
export function settingsToPeriodsConfig(operations: {
  weekdayPeriods: PeriodRowSetting[];
  weekendPeriods: PeriodRowSetting[];
  subjects?: { key: string; weekdayPeriods?: PeriodRowSetting[] }[];
  /** 교시 방식 — "plain"(새 학원)이면 PeriodsConfig.plain. 침산(기본 "chinsan")은 키를 싣지 않아 종전과 같은 객체다. */
  periodStyle?: string;
}): PeriodsConfig {
  const toTable = (rows: PeriodRowSetting[]): Record<string, PeriodTime> => {
    const t: Record<string, PeriodTime> = {};
    rows.forEach((r, i) => {
      // 라벨은 학원장이 지은 이름. 🔴 **빈 문자열을 버리지 말 것**(2026-08-13) — 학원장이 이름을 비운 건
      // "이름 없이 시간대만 보여 달라"는 뜻이라 `N교시` 폴백과 **구분해야** 한다. 그래서
      //   · 설정에 label 칸이 있으면(빈 값이어도) 그대로 싣고
      //   · 칸 자체가 없는 옛 저장분만 undefined로 남긴다(→ 소비처가 `N교시`로 폴백).
      const label = typeof r.label === "string" ? r.label.trim() : undefined;
      t[String(i + 1)] = {
        startTime: hm(r.startTime),
        endTime: hm(r.endTime),
        ...(label === undefined ? {} : { label }),
      };
    });
    return t;
  };
  let weekdayBySubject: Record<string, Record<string, PeriodTime>> | undefined;
  for (const s of operations.subjects ?? []) {
    if (s.weekdayPeriods?.length) {
      (weekdayBySubject ??= {})[s.key] = toTable(s.weekdayPeriods);
    }
  }
  return {
    weekday: operations.weekdayPeriods.length ? toTable(operations.weekdayPeriods) : MATH_PERIODS,
    weekend: operations.weekendPeriods.length ? toTable(operations.weekendPeriods) : WEEKEND_PERIODS,
    ...(weekdayBySubject ? { weekdayBySubject } : {}),
    ...(operations.periodStyle === "plain" ? { plain: true } : {}),
  };
}

/** 과목의 평일 교시표 해석 — 과목 전용 override ?? (english=ENGLISH_PERIODS, 그 외=전역 weekday). */
export function weekdayTableFor(subject: string, config: PeriodsConfig): Record<string, PeriodTime> {
  const custom = config.weekdayBySubject?.[subject];
  if (custom) return custom;
  // 내장 영어 11교시(침산 EiE·인재원 영어 교시)는 침산 방식에서만 폴백 — 새 학원 영어는 전역 교시를 쓴다.
  return subject === "english" && !config.plain ? ENGLISH_PERIODS : config.weekday;
}

/** 교시 목록 한 줄 — id는 식별자(index+1), label은 학원설정에서 지은 이름(없으면 소비처가 번호로 폴백). */
export type PeriodListItem = { id: string; startTime: string; endTime: string; label?: string };

/**
 * 교시 **이름**. 모든 시간표 표면이 이 규칙 하나를 쓴다.
 *  · 이름이 있으면 그대로("EiE 1교시").
 *  · `undefined`(내장 교시표 — 이름이라는 개념이 없는 표) → 기존 `N교시` 폴백.
 *  · `""`(학원장이 설정에서 **비운** 경우, 2026-08-13) → **빈 문자열**. "이름을 안 붙이겠다"는 뜻이라
 *    번호를 지어내지 않는다. 이름 자리에 시각을 따로 안 그리는 화면은 [periodRowText]/[periodSoloLabel]로.
 */
export function periodListLabel(p: Pick<PeriodListItem, "id" | "label">): string {
  // ⚠️ `typeof`로 본다 — 설정 jsonb는 읽을 때 스키마를 안 거치므로(resolveSettings는 deep-merge뿐)
  //    저장된 `label: null`이 여기까지 올 수 있고, `=== undefined`만 보면 `null.trim()`으로 죽는다.
  if (typeof p.label !== "string") return `${p.id}교시`;
  return p.label.trim();
}

/**
 * 이름을 **홀로** 찍는 자리(시각을 따로 안 그리는 화면·읽어주기)용 표기 — 이름이 비면 시간대로 대체한다.
 * 라벨과 시각을 따로 그리는 축(기본뷰·통합뷰)은 이걸 쓰지 말 것(같은 값이 두 번 찍힌다).
 */
export function periodSoloLabel(p: Pick<PeriodListItem, "id" | "label" | "startTime" | "endTime">): string {
  return periodListLabel(p) || `${hm(p.startTime)}~${hm(p.endTime)}`;
}

/** [PeriodRow]를 한 덩어리 문자열로 — 이름이 비면 시간대(`14:20~15:00`). periodSoloLabel의 행(row) 판. */
export function periodRowText(row: Pick<PeriodRow, "label" | "time">): string {
  return row.label || row.time;
}

const toListItem = (id: string, t: PeriodTime): PeriodListItem => ({
  id,
  startTime: hm(t.startTime),
  endTime: hm(t.endTime),
  // ⚠️ 빈 문자열도 그대로 넘긴다 — "이름 비움"과 "이름 없음(내장표)"은 다른 뜻이다(periodListLabel).
  ...(t.label === undefined ? {} : { label: t.label }),
});

/**
 * 과목의 평일 개별 교시 목록(그룹 X) — 반 편집 클릭그리드용. english=10교시, 그 외=config.weekday(보통 8).
 * subject 문자열은 느슨히 받아 "english"만 특수처리(arts·etc·highmath 등은 수학계열 평일표).
 */
export function subjectWeekdayPeriods(
  subject: string,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
): PeriodListItem[] {
  const table = weekdayTableFor(subject, config);
  return Object.entries(table)
    .map(([id, t]) => {
      const item = toListItem(id, t);
      // 수학 평일 한 교시는 두 칸이다. 저장 식별자·시각은 그대로 두고 기본 번호만 반교시로 표시한다.
      // 직접 지은 이름과 의도적으로 비운 이름은 보존한다. 주말은 subjectWeekendPeriods의 시간 단위 번호다.
      if (!config.plain && (subject === "math" || subject === "highmath") &&
        (t.label == null || t.label.trim() === `${id}교시`)) {
        const n = Number(id);
        item.label = `${Math.ceil(n / 2)}-${n % 2 === 1 ? 1 : 2}`;
      }
      return item;
    })
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * 주말(토·일) 개별 교시 목록 — 반 편집 클릭그리드 주말 열용. 주말은 과목 무관 config.weekend(보통 8교시·시간단위).
 * 평일 교시(subjectWeekdayPeriods)와 시각이 달라(주말 09:00~ / 평일 14:30~) 별도 표로 렌더해야 한다.
 */
export function subjectWeekendPeriods(config: PeriodsConfig = DEFAULT_PERIODS_CONFIG): PeriodListItem[] {
  return Object.entries(config.weekend)
    .map(([id, t]) => toListItem(id, t))
    .sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * 그 과목 **평일 '한 교시'의 길이(분)** — 수학계열은 세부교시 2개가 묶여 한 교시다(1교시 14:30~16:20 = 110분,
 * [mathGroups]와 같은 묶음). 이 값이 곧 "완교시" 기준이고, 그보다 짧게 쓰면 화면에서 '반교시' 셀이 된다.
 *
 * ⚠️ 영어는 그룹이 없어(교시 = 표의 한 줄) **null**을 준다 — '반교시'라는 개념 자체가 없는 과목이다.
 *    소비처는 null을 "판정하지 않음"으로 다뤄야 한다(0으로 떨어뜨리면 전 반이 반교시가 된다).
 * ⚠️ 그룹 길이가 서로 다르면 **가장 짧은 그룹**을 기준으로 한다 — 기준을 넉넉히 잡아야 완교시 반을
 *    반교시로 잘못 모는 일이 없다(빼는 쪽이 위험한 판정이라 오탐을 줄이는 방향으로 기운다).
 */
export function weekdayFullPeriodMinutes(
  subject: string,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
): number | null {
  if (isPerPeriodSubject(subject, config)) return null;
  const table = weekdayTableFor(subject, config);
  const ids = Object.keys(table).sort((a, b) => Number(a) - Number(b));
  if (ids.length < 2) return null;
  let shortest = Infinity;
  for (let i = 0; i + 1 < ids.length; i += 2) {
    const first = table[ids[i]!]!;
    const second = table[ids[i + 1]!]!;
    const span = toMin(second.endTime) - toMin(first.startTime);
    if (span > 0) shortest = Math.min(shortest, span);
  }
  return Number.isFinite(shortest) ? shortest : null;
}

/**
 * periodId(통일 또는 레거시) + 과목 + 주말여부 → {startTime, endTime}. 알 수 없으면 null.
 * 주말이면 과목 무관 config.weekend, 평일이면 과목별 표(영어=상수, 그 외=config.weekday).
 */
export function periodToTimes(
  periodId: string,
  subject: string,
  opts?: { weekend?: boolean },
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
): PeriodTime | null {
  const id = normalizePeriodId(periodId);
  const table = opts?.weekend ? config.weekend : weekdayTableFor(subject, config);
  return table[id] ?? null;
}

/** 표시용 라벨 'N교시'. */
export function periodLabel(periodId: string): string {
  return `${normalizePeriodId(periodId)}교시`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 절대시각 → 그리드 행(교시/그룹) 역매핑 — 시간표 기본뷰의 행 축.
// ijw `constants.ts` 이식: 수학/과학/국어/고등수학(평일)은 8교시를 2개씩 4그룹으로 묶어
// 한 행(1교시=14:30~16:20 …)으로 표시(MATH_PERIOD_GROUPS·MATH_GROUP_DISPLAY).
// 영어(평일)는 10교시 개별 행, 주말은 8교시(시간단위) 개별 행.
// ─────────────────────────────────────────────────────────────────────────────

/** 그리드 행 1개(교시 또는 그룹). order로 정렬, key로 셀 그룹핑. */
export type PeriodRow = {
  key: string; // 행 고유키 (m-1 / e-4 / w-3 / x-HH:MM)
  label: string; // "1교시"
  time: string; // "14:30~16:20"
  order: number; // 정렬 순서
};

/** "16:20:00" / "16:20" → "16:20". */
function hm(t: string): string {
  return String(t).slice(0, 5);
}

/** "HH:MM…" → 자정 기준 분. 행 정렬용(시각순). */
function toMin(t: string): number {
  const [h, m] = hm(t).split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** 테이블의 교시를 (시작,종료) 우선 매처가 읽는 목록으로. */
function periodItems(table: Record<string, PeriodTime>): PeriodListItem[] {
  return Object.entries(table).map(([id, t]) => toListItem(id, t));
}

/** 동일 시작시각 교시를 종료시각으로 가르고, 종료가 어긋난 레거시 행만 첫 시작시각으로 폴백. */
function matchPeriodId(
  table: Record<string, PeriodTime>,
  startTime: string,
  endTime?: string | null,
): string | null {
  return buildPeriodMatcher(periodItems(table))({ startTime, endTime });
}

/**
 * 교시축 정렬키. 보통은 자정 기준 분 그대로다.
 * 시작이 같은 교시만 두 번째부터 0.001씩 더해 두 행을 같은 Map 키로 뭉개지 않게 한다.
 * sectionKey는 class-grid에서 정수 분으로 별도 유지하므로 이 소수부는 행 식별에만 쓰인다.
 */
function periodAxisOrder(table: Record<string, PeriodTime>, id: string): number {
  const ids = Object.keys(table).sort((a, b) => Number(a) - Number(b));
  const target = table[id];
  if (!target) return 0;
  const sameStartBefore = ids
    .slice(0, ids.indexOf(id))
    .filter((otherId) => hm(table[otherId]!.startTime) === hm(target.startTime)).length;
  return toMin(target.startTime) + sameStartBefore / 1000;
}

/**
 * 평일 수학계열 교시표 → 2개씩 묶은 그룹(라벨·통합시간대). config.weekday에서 파생.
 * 기본 MATH_PERIODS(8교시)면 4그룹(1교시=14:30~16:20 …)으로 ijw MATH_GROUP_DISPLAY와 동일.
 */
function mathGroups(table: Record<string, PeriodTime>): {
  groupOf: Map<string, number>;
  display: Map<number, { label: string; time: string; order: number }>;
} {
  const ids = Object.keys(table).sort((a, b) => Number(a) - Number(b));
  const groupOf = new Map<string, number>();
  ids.forEach((id, idx) => groupOf.set(id, Math.floor(idx / 2) + 1));
  const display = new Map<number, { label: string; time: string; order: number }>();
  const maxG = Math.ceil(ids.length / 2);
  for (let g = 1; g <= maxG; g++) {
    const first = table[ids[(g - 1) * 2]!]!;
    const secondId = ids[(g - 1) * 2 + 1];
    const second = secondId ? table[secondId]! : first;
    display.set(g, {
      label: `${g}교시`,
      time: `${hm(first.startTime)}~${hm(second.endTime)}`,
      order: toMin(first.startTime),
    });
  }
  return { groupOf, display };
}

/**
 * 한 슬롯(과목·시작시각·요일)을 그리드 행으로 매핑.
 * 매칭 실패 시 그 시각 자체를 '기타' 행으로(절대 throw 금지 — 데모 데이터 시각 불일치 안전).
 */
export function slotPeriodRow(
  subject: string,
  startTime: string,
  day: DayOfWeek,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
  endTime?: string | null,
): PeriodRow {
  const start = hm(startTime);
  if (isWeekendDay(day)) {
    const p = matchPeriodId(config.weekend, start, endTime);
    if (p) {
      const t = config.weekend[p]!;
      return {
        key: `w-${p}`,
        label: periodListLabel({ id: p, label: t.label }),
        time: `${hm(t.startTime)}~${hm(t.endTime)}`,
        order: periodAxisOrder(config.weekend, p),
      };
    }
  } else if (isPerPeriodSubject(subject, config)) {
    // 역조회는 (시작,종료) 우선 — EiE 4교시와 IJW 1교시처럼 시작이 같은 설정도 정확히 가른다.
    const table = weekdayTableFor(subject, config);
    const p = matchPeriodId(table, start, endTime);
    if (p) {
      const t = table[p]!;
      return {
        key: `e-${p}`,
        label: periodListLabel({ id: p, label: t.label }),
        time: `${hm(t.startTime)}~${hm(t.endTime)}`,
        order: periodAxisOrder(table, p),
      };
    }
  } else {
    const table = weekdayTableFor(subject, config);
    const p = matchPeriodId(table, start, endTime);
    if (p) {
      const { groupOf, display } = mathGroups(table);
      const g = groupOf.get(p)!;
      const d = display.get(g)!;
      return { key: `m-${g}`, label: d.label, time: d.time, order: d.order };
    }
  }
  // 폴백: 매칭 안 되는 시각 = 자체 행. 시각 그대로 라벨, 시각순 정렬.
  return { key: `x-${start}`, label: start, time: start, order: toMin(start) };
}

/**
 * 그 시각이 **평일 교시표**에 있으면 그 행을, 없으면 null. (요일은 안 본다.)
 *
 * 용도 = 통합뷰의 평일+주말 혼합 반: 실데이터에 토·일 수업이 평일 교시 시각을 그대로 쓰는 경우가 많다
 * (injaewon 영어 토 14:20·15:00·15:40 = 영어 평일 1·2·3교시). 그런 슬롯은 시프트할 게 아니라 **그 평일
 * 교시 행 그대로** 놓는 게 맞다. `slotPeriodRow`는 요일로 표를 고르므로(주말이면 주말표만) 이걸 못 한다.
 * ⚠️ 주말 **전용** 반에는 쓰지 말 것 — 그쪽 섹션 축은 주말 교시표라 평일 order를 넣으면 셀이 사라진다.
 */
export function weekdayPeriodRowOrNull(
  subject: string,
  startTime: string,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
  endTime?: string | null,
): PeriodRow | null {
  const start = hm(startTime);
  const table = weekdayTableFor(subject, config);
  const p = matchPeriodId(table, start, endTime);
  if (!p) return null;
  const t = table[p]!;
  if (isPerPeriodSubject(subject, config))
    return {
      key: `e-${p}`,
      label: periodListLabel({ id: p, label: t.label }),
      time: `${hm(t.startTime)}~${hm(t.endTime)}`,
      order: periodAxisOrder(table, p),
    };
  const { groupOf, display } = mathGroups(table);
  const g = groupOf.get(p)!;
  const d = display.get(g)!;
  return { key: `m-${g}`, label: d.label, time: d.time, order: d.order };
}

/**
 * 그 과목/평일·주말의 **표준 교시 행 전체**(수업 없어도 표시 — 빈 교시도 균일 높이 유지).
 * 평일 수학계열 = 4그룹(1교시 14:30~16:20 …), 영어 = 10교시, 주말 = 8교시(시간단위).
 */
export function subjectPeriodRows(
  subject: string,
  weekend: boolean,
  config: PeriodsConfig = DEFAULT_PERIODS_CONFIG,
): PeriodRow[] {
  let out: PeriodRow[];
  if (weekend) {
    out = Object.entries(config.weekend).map(([p, t]) => ({
      key: `w-${p}`,
      label: periodListLabel({ id: p, label: t.label }),
      time: `${hm(t.startTime)}~${hm(t.endTime)}`,
      order: periodAxisOrder(config.weekend, p),
    }));
  } else if (isPerPeriodSubject(subject, config)) {
    const table = weekdayTableFor(subject, config);
    out = Object.entries(table).map(([p, t]) => ({
      key: `e-${p}`,
      label: periodListLabel({ id: p, label: t.label }),
      time: `${hm(t.startTime)}~${hm(t.endTime)}`,
      order: periodAxisOrder(table, p),
    }));
  } else {
    out = Array.from(mathGroups(weekdayTableFor(subject, config)).display.entries()).map(([g, d]) => ({
      key: `m-${g}`,
      label: d.label,
      time: d.time,
      order: d.order,
    }));
  }
  return out.sort((a, b) => a.order - b.order);
}
