import { shiftMonth } from "@/lib/date-kst";
import { scoreRaws, sumRaws } from "./calc";
import { METRICS, emptyRaws, type ContributionConfig, type Metric, type Raws } from "./config";

type Month = { month: string; raws: Raws; correction: Raws; payload: { correctionReasons: unknown[] };
  closedAt?: string | null; computedAt?: string; reconstructed?: boolean; unavailable?: readonly unknown[] };
/** closed=마감 · current=이번 달 집계 중 · unclosed=지난 달인데 마감 전 · merged=병합 전 원생의 달 · none=집계 기록 없음 */
export type MonthStatus = "closed" | "current" | "unclosed" | "merged" | "none";
/** 한 달 안의 항목별 점수. value=그 달 실적, correction=그 달에 들어온 정정(음수 보존). */
export type MonthItem = { metric: Metric; value: number; correction: number };
export type TrendPoint = {
  month: string; total: number; change: number; operations: number; participation: number; correction: number;
  corrected: boolean; hasRecord: boolean; status: MonthStatus; reconstructed: boolean; items: MonthItem[];
  /** 자료를 확인하지 못해 확인된 실적만 반영한 항목 수. 0점이어도 '실제 0'이라 단정하지 않는다. */
  unavailable: number;
};

/** Accumulate integer source values, matching the score card at every point, including half-cent boundaries. */
export function contributionTrend(months: readonly Month[], config: ContributionConfig, currentMonth?: string): TrendPoint[] {
  const ordered = [...months].sort((a, b) => a.month.localeCompare(b.month));
  if (!ordered.length) return [];
  const byMonth = new Map(ordered.map((m) => [m.month, m]));
  const points: TrendPoint[] = []; let accumulated = emptyRaws();
  for (let month = ordered[0]!.month; month <= ordered.at(-1)!.month; month = shiftMonth(month, 1)) {
    const row = byMonth.get(month), raw = row ? sumRaws([row.raws, row.correction]) : emptyRaws();
    accumulated = sumRaws([accumulated, raw]);
    const base = scoreRaws(row?.raws ?? emptyRaws(), config), fix = scoreRaws(row?.correction ?? emptyRaws(), config);
    points.push({ month, total: scoreRaws(accumulated, config).total, change: scoreRaws(raw, config).total,
      operations: base.operations, participation: base.participation, correction: fix.total,
      corrected: !!row?.payload.correctionReasons.length, hasRecord: !!row, reconstructed: !!row?.reconstructed, unavailable: row?.unavailable?.length ?? 0,
      status: !row ? "none" : row.computedAt === "" ? "merged" : row.closedAt ? "closed" : month === currentMonth ? "current" : "unclosed",
      items: row ? METRICS.flatMap((metric) => base.points[metric] || fix.points[metric] ? [{ metric, value: base.points[metric], correction: fix.points[metric] }] : []) : [] });
  }
  return points;
}

export type MonthComparison =
  | { kind: "change"; previous: string; previousChange: number; delta: number }
  | { kind: "open"; previous: string | null; previousChange: number | null }
  | { kind: "missing" | "previous-open" | "previous-merged"; previous: string }
  | { kind: "first" | "merged" | "none" };
/**
 * 마감된 두 달끼리만 증감을 판정한다. 집계 중인 달·기록 없는 달·병합 전 달과는 견주지 않는다.
 * 비율은 만들지 않는다(지난달이 0이면 무한대가 된다).
 */
type Comparable = Pick<TrendPoint, "month" | "change"> & Partial<Pick<TrendPoint, "hasRecord" | "status">>;
export function compareMonth(points: readonly Comparable[], month: string): MonthComparison {
  const index = points.findIndex((p) => p.month === month), point = points[index];
  if (!point || point.hasRecord === false) return { kind: "none" };
  if (point.status === "merged") return { kind: "merged" };
  const previous = points[index - 1];
  if (point.status !== "closed") return { kind: "open", previous: previous?.month ?? null,
    previousChange: previous?.status === "closed" ? previous.change : null };
  if (!previous) return { kind: "first" };
  if (previous.hasRecord === false) return { kind: "missing", previous: previous.month };
  if (previous.status === "merged") return { kind: "previous-merged", previous: previous.month };
  if (previous.status !== "closed") return { kind: "previous-open", previous: previous.month };
  return { kind: "change", previous: previous.month, previousChange: previous.change, delta: point.change - previous.change };
}

type Totals = Pick<Month, "month" | "raws" | "correction">;
/** 목록의 '최근 12개월'과 같은 방식: 기간 안의 원수치를 먼저 더하고 현재 배점을 한 번 적용한다. */
export function scoreBetween(months: readonly Totals[], config: ContributionConfig, from: string, through: string) {
  return scoreRaws(rawsBetween(months, from, through), config);
}
export function rawsBetween(months: readonly Totals[], from: string, through: string) {
  return sumRaws(months.filter((m) => m.month >= from && m.month <= through).flatMap((m) => [m.raws, m.correction]));
}
