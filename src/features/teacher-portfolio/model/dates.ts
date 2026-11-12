/** 직원 포트폴리오 계산이 쓰는 날짜 도구. 날짜는 `YYYY-MM-DD` 문자열, 시각은 ISO 문자열이다. */
import { AXIS_DOW } from "@/features/attendance/teacher-axis";
import { addDays, monthOf, monthRange, shiftMonth, weekdayIndexOf } from "@/lib/date-kst";
import type { PeriodWindow } from "./types";

export { addDays };

// 출결·보고서 행마다 부른다(수만 번). `date-kst`의 kstDateOf는 호출마다 포맷터를 새로 만들어 여기선 느리다.
const kstFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
/** 시각을 한국 날짜로. 마감은 한국 시간 말일 24시라서 입력 시각은 늘 이 날짜로 비교한다. */
export function kstDateOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : kstFormatter.format(at);
}

export const dowOf = (day: string): string => AXIS_DOW[weekdayIndexOf(day)];
export const between = (value: string | null | undefined, from: string, to: string): boolean =>
  Boolean(value) && (value as string) >= from && (value as string) <= to;
export { round1 } from "@/lib/guards";

export function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}
export function monthDays(month: string): string[] {
  const { from, to } = monthRange(month);
  return daysBetween(from, to);
}

/**
 * 기준일이 속한 달부터 거꾸로 `count`개월. 진행 중인 달은 기준일에서 끊고 `partial`로 표시한다.
 * `end`는 수업 대상 날짜의 끝일 뿐, 입력 마감이 아니다 — 진행 중인 달의 입력 인정 시각은 조회 시각이다.
 */
export function monthWindows(end: string, count: number): PeriodWindow[] {
  return Array.from({ length: count }, (_, i) => {
    const month = shiftMonth(monthOf(end), -i);
    const { from, to } = monthRange(month);
    return { month, start: from, end: to > end ? end : to, partial: to > end };
  });
}

/** 월~일 주. 달(또는 기준일) 경계에서 자른다. */
export function weeksOf(window: Pick<PeriodWindow, "start" | "end">): { start: string; end: string }[] {
  const weeks: { start: string; end: string }[] = [];
  for (let start = window.start; start <= window.end;) {
    const sunday = addDays(start, 6 - ((weekdayIndexOf(start) + 6) % 7));
    const end = sunday > window.end ? window.end : sunday;
    weeks.push({ start, end });
    start = addDays(end, 1);
  }
  return weeks;
}

/** 다음 달 같은 날. 그 날짜가 없으면 다음 달 말일. */
export function sameDayNextMonth(day: string): string {
  const next = monthRange(shiftMonth(monthOf(day), 1));
  const candidate = `${next.from.slice(0, 8)}${day.slice(8)}`;
  return candidate > next.to ? next.to : candidate;
}

/** 메모에서 읽은 날짜가 달력에 있는 날인지(2월 30일 같은 값을 거른다). */
export const isCalendarDate = (day: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(day) && addDays(day, 0) === day;

export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = map.get(k);
    if (bucket) bucket.push(row);
    else map.set(k, [row]);
  }
  return map;
}
export const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];
