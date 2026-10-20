import type { PeriodKeys, StatsPeriod } from "@/features/stats/period";

/**
 * **지출 추이**(원장 2026-10-20 *"상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"*) — 운영실 '이번 달 지출 내역'과 같은 줄
 * (지출일 `expense_date` · 결재 상태를 가리지 않는 지출결의서 전건 — `getExpensesForMonth`)을 칸(달 · 날)마다 더한다. 순수 함수(Vitest).
 * 🔑 통화를 섞지 않는다(₩와 $를 한 숫자로 더하지 않는다 — `summarizeExpenses`와 같은 규칙): 선은 **주 통화**(건수가 가장 많은 통화)만,
 * 다른 통화는 기간 합계를 따로 적는다. 분류 선은 주 통화 금액이 큰 넷까지. 지출일은 실제 날짜라 일별도 정직하다.
 */
export const EXPENSE_TREND_KEYS: PeriodKeys = { grain: "ex", month: "exMonth", from: "exFrom", to: "exTo", span: "exSpan" };
export const EXPENSE_CATEGORY_LINES = 4;

export type ExpenseTrendRow = { date: string; amount: number; currency: string; category: string };
export type ExpenseTrend = {
  keys: string[];
  currency: string;
  total: number[];
  count: number[];
  categories: { category: string; values: number[] }[];
  /** 주 통화 밖 통화의 기간 합계(건수 많은 순). */
  others: { currency: string; total: number; count: number }[];
  /**
   * 칸마다 주 통화 밖 통화의 합계(통화 이름순) — 기간 전체로 고른 주 통화가 그 칸의 주 통화와 다를 수 있어(운영실 카드는 이번 달만으로
   * 고른다) 칸에서 빠지는 지출이 없게 표에 따로 적는다(리뷰 2026-10-21).
   */
  othersAt: { currency: string; total: number; count: number }[][];
};

export function expenseTrend(rows: readonly ExpenseTrendRow[], period: StatsPeriod, fallbackCurrency: string): ExpenseTrend {
  const keys = period.grain === "month" ? period.months : period.days;
  const at = new Map(keys.map((k, i) => [k, i]));
  const inPeriod = rows.filter((r) => at.has(period.grain === "month" ? r.date.slice(0, 7) : r.date));
  const byCur = new Map<string, { total: number; count: number }>();
  for (const r of inPeriod) {
    const c = byCur.get(r.currency) ?? { total: 0, count: 0 };
    c.total += r.amount;
    c.count += 1;
    byCur.set(r.currency, c);
  }
  const ranked = [...byCur].map(([currency, v]) => ({ currency, ...v })).sort((a, b) => b.count - a.count || b.total - a.total || a.currency.localeCompare(b.currency));
  const currency = ranked[0]?.currency ?? fallbackCurrency;
  const total = keys.map(() => 0);
  const count = keys.map(() => 0);
  const othersAt = keys.map(() => new Map<string, { total: number; count: number }>());
  const byCat = new Map<string, number[]>();
  for (const r of inPeriod) {
    const i = at.get(period.grain === "month" ? r.date.slice(0, 7) : r.date)!;
    if (r.currency !== currency) {
      const o = othersAt[i]!.get(r.currency) ?? { total: 0, count: 0 };
      o.total += r.amount;
      o.count += 1;
      othersAt[i]!.set(r.currency, o);
      continue;
    }
    total[i]! += r.amount;
    count[i]!++;
    const v = byCat.get(r.category) ?? keys.map(() => 0);
    v[i]! += r.amount;
    byCat.set(r.category, v);
  }
  const sum = (v: number[]) => v.reduce((n, x) => n + x, 0);
  const categories = [...byCat]
    .map(([category, values]) => ({ category, values }))
    .sort((a, b) => sum(b.values) - sum(a.values) || a.category.localeCompare(b.category))
    .slice(0, EXPENSE_CATEGORY_LINES);
  return {
    keys,
    currency,
    total,
    count,
    categories,
    others: ranked.filter((r) => r.currency !== currency),
    othersAt: othersAt.map((m) => [...m].map(([c, v]) => ({ currency: c, ...v })).sort((a, b) => a.currency.localeCompare(b.currency))),
  };
}
