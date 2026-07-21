// 출석부 달력 메타 — 요일 키 ↔ 인덱스, 등원요일 표기, 공휴일 조회. 순수 함수(Vitest).
// 공휴일은 **학원설정(operations.holidays)이 단일 소스**다 — 여기에 날짜를 하드코딩하지 말 것
// (설정에 없는 휴일이 화면에 새는 "설정 무시" 버그가 된다).

/** DB `class_schedules.day_of_week` / `enrollments.attendance_days` enum — 인덱스 = JS getDay(). */
export const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const DOW_LABELS = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 요일 키("mon") → 0~6. 모르는 값은 -1. */
export function dowIndexOf(key: string | null | undefined): number {
  if (!key) return -1;
  return DOW_KEYS.indexOf(key.trim().toLowerCase() as (typeof DOW_KEYS)[number]);
}

/** 요일 키 배열 → 정렬된 중복 없는 인덱스 배열(모르는 값은 버림). */
export function dowsFromKeys(keys: readonly (string | null)[] | null | undefined): number[] {
  if (!keys) return [];
  const set = new Set<number>();
  for (const k of keys) {
    const i = dowIndexOf(k);
    if (i >= 0) set.add(i);
  }
  return [...set].sort((a, b) => a - b);
}

/** 등원요일 표기 — [1,4] → "월·목". 빈 배열은 빈 문자열(호출부가 폴백 결정). */
export function formatDows(dows: readonly number[]): string {
  return dows
    .filter((d) => d >= 0 && d <= 6)
    .map((d) => DOW_LABELS[d])
    .join("·");
}

/**
 * 학생의 실제 등원요일 — 분리등원(`enrollments.attendance_days`)이 비어 있으면 반의 수업요일 전체.
 * (eligibility.enrollmentAttendsOnDay와 같은 규약 — 빈 배열 = 반 운영 요일 전부)
 */
export function resolveAttendDows(
  attendanceDays: readonly (string | null)[] | null | undefined,
  classDows: readonly number[],
): number[] {
  const own = dowsFromKeys(attendanceDays);
  if (own.length === 0) return [...classDows];
  // 반이 운영하지 않는 요일이 분리등원에 남아 있어도 반 요일로 제한(스케줄이 진실).
  const allowed = new Set(classDows);
  const narrowed = own.filter((d) => allowed.has(d));
  return narrowed.length > 0 ? narrowed : own;
}

/** 학원설정 공휴일 배열 → date("YYYY-MM-DD") → 이름 맵. 이름이 비면 "휴일"로 폴백. */
export function buildHolidayMap(
  holidays: readonly { date: string; name?: string | null }[] | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of holidays ?? []) {
    const d = (h?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    out[d] = (h.name ?? "").trim() || "휴일";
  }
  return out;
}
