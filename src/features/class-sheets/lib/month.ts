/**
 * ECS 월간 뷰의 격자 구조 — 순수(Vitest). 서버·클라가 함께 쓰므로 `server-only` 금지([[#61]]).
 *
 * 주간 시트가 `weekDatesOf`(월~일 7칸)로 서는 것처럼, 월간 뷰는 **주 행 × 수업 요일 열**로 선다.
 * 🔴 열을 요일 7개로 고정하지 않는 이유: 영어 반은 주 2~4일만 도는 곳이 많아(실측 중등E_초6 SKY는
 *    월·수·목) 7열이면 칸의 절반이 늘 비고, 그만큼 한 칸이 좁아져 진도·과제가 잘린다. 그래서 **그 달에
 *    실제로 배정이 있는 요일만** 열로 세운다(원장 2026-08-31 시안 확정).
 * ⚠️ 월 범위·달 이동·라벨은 [`date-kst`](@/lib/date-kst)의 `monthRange`/`shiftMonth`/`monthLabel`이
 *    단일 소스다 — 여기서 다시 만들지 말 것(월 표기가 화면마다 갈린다).
 */
import { monthRange } from "@/lib/date-kst";
import { mondayOf, shiftDays } from "@/features/timetable/lib/week";
import { dowKeyOf, type DowKey } from "./week";

export const MONTH_RE = /^\d{4}-\d{2}$/;

/** 월→일 순서(달력 열 정렬의 단일 기준). */
export const DOW_ORDER: readonly DowKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * "YYYY-MM" 정규화 — 모양이 아니면 폴백(오늘의 달). 잘못된 URL로 화면이 죽지 않게 한다.
 * ⚠️ 존재하지 않는 달(2026-13)도 모양은 맞으므로 여기서 걸러 낸다.
 */
export function normalizeMonth(raw: string | null | undefined, fallbackMonth: string): string {
  if (!raw || !MONTH_RE.test(raw)) return fallbackMonth;
  const m = Number(raw.slice(5, 7));
  if (m < 1 || m > 12) return fallbackMonth;
  return raw;
}

/** 그 달의 모든 날짜(YYYY-MM-DD, 오름차순). */
export function monthDates(month: string): string[] {
  const { from, to } = monthRange(month);
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDays(d, 1)) out.push(d);
  return out;
}

export type MonthWeek = {
  /** 그 주의 월요일 — 달 밖일 수 있다(8월 1일이 토요일이면 7/27). 주간 시트 링크의 키다. */
  monday: string;
  /** 화면에 적는 "N주" — 그 달 안에서의 순번(1부터). */
  index: number;
  /** 그 주에서 **이 달에 속한** 날짜만. */
  dates: string[];
};

/**
 * 그 달을 덮는 주 목록(월요일 시작). 각 주는 이 달의 날짜만 담는다 —
 * 옆 달 날짜까지 그리면 "지난달 계획"이 이 달 화면에 섞인다.
 */
export function monthWeeks(month: string): MonthWeek[] {
  const byMonday = new Map<string, string[]>();
  for (const date of monthDates(month)) {
    const monday = mondayOf(date);
    const list = byMonday.get(monday);
    if (list) list.push(date);
    else byMonday.set(monday, [date]);
  }
  return [...byMonday.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([monday, dates], i) => ({ monday, index: i + 1, dates }));
}

/**
 * 이 달에 수업이 도는 요일 — 열의 정체다. 인자는 "배정이 살아 있는 날짜"들이고,
 * 여기서 요일로 접어 **월→일 순**으로 돌려준다(입력 순서에 좌우되지 않게).
 * ⚠️ 배정이 하루도 없으면 빈 배열 — 호출부가 "이 달에는 수업이 없습니다"를 그린다.
 */
export function activeDowsOf(dates: Iterable<string>): DowKey[] {
  const seen = new Set<DowKey>();
  for (const date of dates) seen.add(dowKeyOf(date));
  return DOW_ORDER.filter((d) => seen.has(d));
}

/**
 * 주 행 × 요일 열 격자에서 한 칸의 날짜. 그 달 밖이면 `null`(빈 칸으로 그린다).
 * 🔴 `dates`에서 찾는 게 아니라 **월요일 + 요일 오프셋**으로 계산한다 — 수업이 없는 날도 칸은
 *    있어야 열이 어긋나지 않는다(그 칸은 "수업 없음"으로 그린다).
 */
export function cellDateOf(week: MonthWeek, dow: DowKey, month: string): string | null {
  const offset = DOW_ORDER.indexOf(dow);
  if (offset < 0) return null;
  const date = shiftDays(week.monday, offset);
  return date.slice(0, 7) === month ? date : null;
}
