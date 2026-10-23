/**
 * 운영실 **'전일'** = 어제 · **월요일엔 토·일 주말 전체**(원장 2026-10-22 *"월요일의 전일은 주말 모두 포함"*). 순수(Vitest).
 * '전일 입테'·'전일 / 이달 신규'(카드·팝업·요약형)가 이 한 함수로 기간을 정한다 — 칸마다 따로 정하면 월요일에 두 칸이 다른 날을 센다.
 * 공휴일은 따지지 않는다(달력 요일만).
 */
import { addDays, weekdayIndexOf } from "@/lib/date-kst";

export type DayRange = { from: string; to: string };

export function previousDayRange(today: string): DayRange {
  const to = addDays(today, -1);
  return { from: weekdayIndexOf(today) === 1 ? addDays(today, -2) : to, to };
}

/** 화면 글자(카드 보조 줄·팝업 제목 — 짧게) — 하루면 `10/21`, 월요일이면 `주말 10/24~10/25`. */
export function previousDayText(range: DayRange): string {
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
  return range.from === range.to ? md(range.to) : `주말 ${md(range.from)}~${md(range.to)}`;
}

/** 이 날짜가 전일 기간 안인가. */
export function inPreviousDays(ymd: string, range: DayRange): boolean {
  return ymd >= range.from && ymd <= range.to;
}
