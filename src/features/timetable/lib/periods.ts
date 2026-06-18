// 교시(periodId) ↔ 절대시각 변환 + 요일 한글↔enum 변환 — 순수 함수.
// ijw `components/Timetable/constants.ts`의 PERIOD_INFO를 eywa로 이식.
// eywa는 DB에 절대시각(start_time/end_time)만 저장하므로, 이 변환은 엑셀 import 어댑터(Phase 3)가
// periodId→시각으로 1회 적용하는 데 쓰인다. periodLabel은 표시 전용.
//
// 평일: 과목별 교시표. math/highmath/science/korean = 8교시 55분(동일), english = 10교시.
// 주말(토·일): 09:00부터 1시간 단위 8교시(과목 무관).

export type TimetableSubject = "math" | "highmath" | "english" | "science" | "korean";
// day_of_week enum(mon..sun)을 미러. DB 결합을 피하려 로컬 정의.
export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export interface PeriodTime {
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
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

// 영어 교시표(10교시 — 1~6은 40분, 7~10은 55분).
const ENGLISH_PERIODS: Record<string, PeriodTime> = {
  "1": { startTime: "14:20", endTime: "15:00" },
  "2": { startTime: "15:00", endTime: "15:40" },
  "3": { startTime: "15:40", endTime: "16:20" },
  "4": { startTime: "16:20", endTime: "17:00" },
  "5": { startTime: "17:00", endTime: "17:40" },
  "6": { startTime: "17:40", endTime: "18:20" },
  "7": { startTime: "18:20", endTime: "19:15" },
  "8": { startTime: "19:15", endTime: "20:10" },
  "9": { startTime: "20:10", endTime: "21:05" },
  "10": { startTime: "21:05", endTime: "22:00" },
};

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

function weekdayTable(subject: TimetableSubject): Record<string, PeriodTime> {
  return subject === "english" ? ENGLISH_PERIODS : MATH_PERIODS;
}

/**
 * periodId(통일 또는 레거시) + 과목 + 주말여부 → {startTime, endTime}. 알 수 없으면 null.
 * 주말이면 과목 무관 WEEKEND_PERIODS, 평일이면 과목별 표.
 */
export function periodToTimes(
  periodId: string,
  subject: TimetableSubject,
  opts?: { weekend?: boolean },
): PeriodTime | null {
  const id = normalizePeriodId(periodId);
  const table = opts?.weekend ? WEEKEND_PERIODS : weekdayTable(subject);
  return table[id] ?? null;
}

/** 표시용 라벨 'N교시'. */
export function periodLabel(periodId: string): string {
  return `${normalizePeriodId(periodId)}교시`;
}
