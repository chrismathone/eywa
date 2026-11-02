/**
 * 비포클래스체크리스트 — 학생 통계(주간·월간) 묶기와 '기록한 날' 판정(순수 · Vitest).
 *
 * 원장 2026-10-28 *"학생별 통계도 보고 싶음 주간, 월간 등등"*.
 * 🔴 **기록한 날** = 이 반에서 체크를 처음 한 날(추적 시작) ~ 오늘. 시트처럼 그 안의 수업일에 체크가 없으면 '모두 해 옴'으로
 *    세지만, 시작 **전** 수업일은 세지 않는다 — 기능을 연 날(10/28) 이전 수업일이 전부 100%로 부풀던 것을 막는다.
 */
import {
  BEFORE_CLASS_CARDS, BEFORE_CLASS_ITEMS, completionRate, effectiveCard, needsSupplement, normalizeMissed,
  type BeforeClassCard, type BeforeClassCheck, type BeforeClassItemKey,
} from "./items";

export type DayRecord = { date: string; check: BeforeClassCheck };
export type StatUnit = "week" | "month";
export type PeriodStat = {
  key: string;
  label: string;
  lessons: number;
  absentCount: number;
  supplementCount: number;
  /** 결석 뺀 평균 완료율(0~1) — 출석한 수업이 없으면 null. */
  average: number | null;
  itemCounts: Record<BeforeClassItemKey, number>;
  /** 받은 카드 수(카드 X 포함 · 안 고른 날은 자동 카드) — 결석 날은 고른 카드만 센다(카드는 출결과 따로 준다). */
  cardCounts: Record<BeforeClassCard, number>;
};

export const DONE_CHECK: BeforeClassCheck = { missed: [], absent: false, card: null };

/** 이 날을 통계에 넣는가 — 추적 시작 ~ 오늘(둘 다 포함). 시작이 없으면(체크 0건) 아무 날도 안 넣는다. */
export function isRecordedDay(date: string, today: string, trackingStart: string | null): boolean {
  return trackingStart !== null && date >= trackingStart && date <= today;
}

function utc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

/** 그 주 월요일. */
export function weekStartOf(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return ymd(d);
}

function periodOf(date: string, unit: StatUnit): { key: string; label: string } {
  if (unit === "month") return { key: date.slice(0, 7), label: `${Number(date.slice(0, 4))}년 ${Number(date.slice(5, 7))}월` };
  const start = weekStartOf(date);
  const end = utc(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { key: start, label: `${md(start)}~${md(ymd(end))}` };
}

const emptyItems = () => Object.fromEntries(BEFORE_CLASS_ITEMS.map((i) => [i.key, 0])) as Record<BeforeClassItemKey, number>;

/** 하루 기록들을 기간마다 묶는다 — 최신 기간이 먼저. */
export function groupStats(days: readonly DayRecord[], unit: StatUnit): PeriodStat[] {
  const map = new Map<string, { label: string; days: DayRecord[] }>();
  for (const d of days) {
    const p = periodOf(d.date, unit);
    const entry = map.get(p.key) ?? { label: p.label, days: [] };
    entry.days.push(d);
    map.set(p.key, entry);
  }
  return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([key, v]) => totalStat(v.days, key, v.label));
}

/** 묶음 하나의 합계 — 기간 전체 요약에도 쓴다. */
export function totalStat(days: readonly DayRecord[], key = "all", label = "전체"): PeriodStat {
  const rates = days.map((d) => completionRate(d.check)).filter((r): r is number => r !== null);
  const itemCounts = emptyItems();
  const cardCounts = Object.fromEntries(BEFORE_CLASS_CARDS.map((c) => [c.key, 0])) as Record<BeforeClassCard, number>;
  for (const d of days) {
    const card = effectiveCard(d.check);
    if (card) cardCounts[card] += 1;
  }
  for (const d of days) {
    if (d.check.absent) continue;
    for (const k of normalizeMissed(d.check.missed)) itemCounts[k] += 1;
  }
  return {
    key,
    label,
    lessons: days.length,
    absentCount: days.filter((d) => d.check.absent).length,
    supplementCount: days.filter((d) => needsSupplement(d.check)).length,
    average: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    itemCounts,
    cardCounts,
  };
}
