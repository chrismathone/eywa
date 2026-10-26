import { expect, it } from "vitest";
import { scoreRaws, sumRaws } from "./calc";
import { DEFAULT_CONFIG, emptyRaws } from "./config";
import { contributionTrend } from "./score-trend";

const row = (month: string, tuitionWon: number, correction = 0) => ({ month, raws: { ...emptyRaws(), tuitionWon },
  correction: { ...emptyRaws(), tuitionWon: correction }, payload: { correctionReasons: correction ? [{}] : [] } });
it("keeps the chart equal to the card at a rounding boundary", () => {
  const months = [row("2026-01", 1000), row("2026-02", 7500)];
  const card = scoreRaws(sumRaws(months.flatMap((m) => [m.raws, m.correction])), DEFAULT_CONFIG).total;
  const end = contributionTrend(months, DEFAULT_CONFIG).at(-1)!;
  expect(end.total).toBe(card);
  expect(end.total.toLocaleString("ko-KR", { maximumFractionDigits: 2 })).toBe("0.09");
});
it("retains missing months and negative corrections using the current rates", () => {
  const config = { ...DEFAULT_CONFIG, rates: { ...DEFAULT_CONFIG.rates, tuitionWon: { enabled: true, points: 2 } } };
  expect(contributionTrend([row("2026-03", 10000, -30000), row("2026-01", 20000)], config)).toEqual([
    { month: "2026-01", total: 0.4, change: 0.4, corrected: false, hasRecord: true },
    { month: "2026-02", total: 0.4, change: 0, corrected: false, hasRecord: false },
    { month: "2026-03", total: 0, change: -0.4, corrected: true, hasRecord: true },
  ]);
  expect(contributionTrend([], config)).toEqual([]);
});
