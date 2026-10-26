import { shiftMonth } from "@/lib/date-kst";
import { scoreRaws, sumRaws } from "./calc";
import { emptyRaws, type ContributionConfig, type Raws } from "./config";

type Month = { month: string; raws: Raws; correction: Raws; payload: { correctionReasons: unknown[] } };
/** Accumulate integer source values, matching the score card at every point, including half-cent boundaries. */
export function contributionTrend(months: readonly Month[], config: ContributionConfig) {
  const ordered = [...months].sort((a, b) => a.month.localeCompare(b.month));
  if (!ordered.length) return [];
  const byMonth = new Map(ordered.map((m) => [m.month, m]));
  const points = []; let accumulated = emptyRaws();
  for (let month = ordered[0]!.month; month <= ordered.at(-1)!.month; month = shiftMonth(month, 1)) {
    const row = byMonth.get(month), raw = row ? sumRaws([row.raws, row.correction]) : emptyRaws();
    accumulated = sumRaws([accumulated, raw]);
    points.push({ month, total: scoreRaws(accumulated, config).total, change: scoreRaws(raw, config).total,
      corrected: !!row?.payload.correctionReasons.length, hasRecord: !!row });
  }
  return points;
}
