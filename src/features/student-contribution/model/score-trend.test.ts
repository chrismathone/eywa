import { expect, it } from "vitest";
import { scoreRaws, sumRaws } from "./calc";
import { DEFAULT_CONFIG, emptyRaws } from "./config";
import { compareMonth, contributionTrend, rawsBetween, scoreBetween } from "./score-trend";

const row = (month: string, tuitionWon: number, correction = 0, extra: { closedAt?: string | null; computedAt?: string; perfectWeeks?: number } = {}) => ({ month,
  raws: { ...emptyRaws(), tuitionWon, perfectWeeks: extra.perfectWeeks ?? 0 }, correction: { ...emptyRaws(), tuitionWon: correction },
  payload: { correctionReasons: correction ? [{}] : [] }, closedAt: extra.closedAt ?? null, computedAt: extra.computedAt ?? "2026-10-01T00:00:00Z" });
it("keeps the chart equal to the card at a rounding boundary", () => {
  const months = [row("2026-01", 1000), row("2026-02", 7500)];
  const card = scoreRaws(sumRaws(months.flatMap((m) => [m.raws, m.correction])), DEFAULT_CONFIG).total;
  const end = contributionTrend(months, DEFAULT_CONFIG).at(-1)!;
  expect(end.total).toBe(card);
  expect(end.total.toLocaleString("ko-KR", { maximumFractionDigits: 2 })).toBe("0.09");
});
it("retains missing months and negative corrections using the current rates", () => {
  const config = { ...DEFAULT_CONFIG, rates: { ...DEFAULT_CONFIG.rates, tuitionWon: { enabled: true, points: 2 } } };
  const points = contributionTrend([row("2026-03", 10000, -30000), row("2026-01", 20000, 0, { closedAt: "x" })], config, "2026-03");
  expect(points.map(({ month, total, change, operations, correction, hasRecord, status }) => ({ month, total, change, operations, correction, hasRecord, status }))).toEqual([
    { month: "2026-01", total: 0.4, change: 0.4, operations: 0.4, correction: 0, hasRecord: true, status: "closed" },
    { month: "2026-02", total: 0.4, change: 0, operations: 0, correction: 0, hasRecord: false, status: "none" },
    { month: "2026-03", total: 0, change: -0.4, operations: 0.2, correction: -0.6, hasRecord: true, status: "current" },
  ]);
  expect(points[2]!.items).toEqual([{ metric: "tuitionWon", value: 0.2, correction: -0.6 }]);
  expect(contributionTrend([], config)).toEqual([]);
});
it("splits operations and learning, and marks merged and unclosed months without treating them as closed", () => {
  const points = contributionTrend([row("2026-01", 100000, 0, { closedAt: "x", perfectWeeks: 1 }), row("2026-02", 0, 0, { computedAt: "" }), row("2026-03", 0)], DEFAULT_CONFIG, "2026-10");
  expect(points[0]).toMatchObject({ operations: 1, participation: 1, change: 2, status: "closed" });
  expect(points.map((p) => p.status)).toEqual(["closed", "merged", "unclosed"]);
  expect(compareMonth(points, "2026-03")).toEqual({ kind: "open", previous: "2026-02", previousChange: null });
  const afterMerged = contributionTrend([row("2026-01", 0, 0, { computedAt: "" }), { ...row("2026-02", 100000, 0, { closedAt: "x" }), unavailable: ["videoAssignments"] }], DEFAULT_CONFIG);
  expect(compareMonth(afterMerged, "2026-02")).toEqual({ kind: "previous-merged", previous: "2026-01" });
  expect(afterMerged[1]!.unavailable).toBe(1);
});
it("compares only two closed months and never makes a ratio from a zero month", () => {
  const closed = (month: string, won: number) => row(month, won, 0, { closedAt: "x" });
  const points = contributionTrend([closed("2026-01", 0), closed("2026-02", 300000), closed("2026-03", 100000), closed("2026-05", 100000), row("2026-06", 500000)], DEFAULT_CONFIG, "2026-06");
  expect(compareMonth(points, "2026-01")).toEqual({ kind: "first" });
  expect(compareMonth(points, "2026-02")).toEqual({ kind: "change", previous: "2026-01", previousChange: 0, delta: 3 });
  expect(compareMonth(points, "2026-03")).toEqual({ kind: "change", previous: "2026-02", previousChange: 3, delta: -2 });
  expect(compareMonth(points, "2026-04")).toEqual({ kind: "none" });
  expect(compareMonth(points, "2026-05")).toEqual({ kind: "missing", previous: "2026-04" });
  // 집계 중인 달은 마감된 달과 같은 조건이 아니므로 증감 판정을 내지 않는다.
  expect(compareMonth(points, "2026-06")).toEqual({ kind: "open", previous: "2026-05", previousChange: 1 });
});
it("sums a period the same way as the list's recent total", () => {
  const months = [row("2025-10", 100000), row("2025-11", 50000, -20000), row("2026-10", 70000)];
  expect(scoreBetween(months, DEFAULT_CONFIG, "2025-11", "9999-12").total).toBe(1);
  expect(rawsBetween(months, "0000-01", "2025-11").tuitionWon).toBe(130000);
});
