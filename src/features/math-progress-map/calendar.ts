/**
 * 진도맵 달력 계산 — 순수(Vitest). 타임존을 타지 않게 **UTC 자정**으로만 센다(날짜 문자열 ↔ 요일).
 *
 * 🔑 주(week)는 **월요일 시작 · 달 안으로 자른 구간**이다(월별 출석부·MCS와 같은 감각 — 9월 1일이 화요일이면
 *    1주는 9/1~9/6). 한 달은 4~6개 주가 되고, 마지막 주가 2~3일짜리일 수 있다(라벨은 폭이 좁으면 감춘다).
 */

export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export type MonthWeek = {
  /** 1부터 — "N주" */
  index: number;
  /** YYYY-MM-DD */
  start: string;
  end: string;
  days: string[];
};

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function ymd(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseYmd(s: string): { y: number; m: number; d: number } {
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) };
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 0=일 … 6=토 */
export function weekdayOf(s: string): number {
  const { y, m, d } = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function weekdayLabel(s: string): string {
  return WEEKDAY_KO[weekdayOf(s)]!;
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** 두 날짜 차이(b − a, 일). */
export function diffDays(a: string, b: string): number {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** 월요일 시작, 달 안으로 자른 주 목록. */
export function weeksOfMonth(year: number, month: number): MonthWeek[] {
  const dim = daysInMonth(year, month);
  const out: MonthWeek[] = [];
  let cur: string[] = [];
  for (let d = 1; d <= dim; d++) {
    const date = ymd(year, month, d);
    // 월요일이면 새 주 — 단 1일은 어떤 요일이든 첫 주를 연다.
    if (cur.length > 0 && weekdayOf(date) === 1) {
      out.push({ index: out.length + 1, start: cur[0]!, end: cur[cur.length - 1]!, days: cur });
      cur = [];
    }
    cur.push(date);
  }
  if (cur.length > 0) out.push({ index: out.length + 1, start: cur[0]!, end: cur[cur.length - 1]!, days: cur });
  return out;
}

/** 그 날짜가 속한 주(1부터). 달 밖이면 null. */
export function weekIndexOf(date: string): number | null {
  const { y, m } = parseYmd(date);
  const week = weeksOfMonth(y, m).find((w) => w.days.includes(date));
  return week ? week.index : null;
}

export function quarterOf(month: number): 1 | 2 | 3 | 4 {
  return (Math.floor((month - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

export function monthsOfQuarter(q: number): number[] {
  const first = (q - 1) * 3 + 1;
  return [first, first + 1, first + 2];
}

/** "9월" */
export function monthLabelKo(month: number): string {
  return `${month}월`;
}

/** "9/16" */
export function formatMd(s: string): string {
  const { m, d } = parseYmd(s);
  return `${m}/${d}`;
}

/** "9/16 (수)" */
export function formatMdW(s: string): string {
  return `${formatMd(s)} (${weekdayLabel(s)})`;
}

/** "2026. 9. 16." — 기준일 표기(레퍼런스 이미지와 같은 모양). */
export function formatDotDate(s: string): string {
  const { y, m, d } = parseYmd(s);
  return `${y}. ${m}. ${d}.`;
}

/** "9/14~9/20" */
export function formatRange(a: string, b: string): string {
  return `${formatMd(a)}~${formatMd(b)}`;
}
