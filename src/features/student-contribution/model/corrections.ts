import { METRICS, type Metric } from "./config";
import type { BuiltMonth, ContributionFact } from "./build";
export type CorrectionDetail = { month: string; metric: Metric; before: number; after: number; delta: number; evidenceIds: string[]; kind: "source" | "alreadyApplied" };
/** 원본 달의 차이와 이미 다른 달에서 반영한 정정을 구분해 이번 달 정정의 출처를 설명한다. */
export function correctionDetails(current: BuiltMonth, closed: readonly BuiltMonth[], facts: readonly ContributionFact[]): CorrectionDetail[] {
  const out: CorrectionDetail[] = [];
  const byMonth = new Map(facts.map((f) => [f.month, f]));
  const frozen = new Map(closed.filter((r) => r.month < current.month).map((r) => [r.month, r]));
  const months = [...new Set([...byMonth.keys(), ...frozen.keys()])].filter((m) => m < current.month).sort();
  for (const metric of METRICS) {
    if (!current.correction[metric]) continue;
    for (const month of months) {
      const before = frozen.get(month)?.raws[metric] ?? 0, after = byMonth.get(month)?.raws[metric] ?? 0;
      if (before !== after) out.push({ month, metric, before, after, delta: after - before, kind: "source",
        evidenceIds: [...new Set([...(frozen.get(month)?.evidenceIds ?? []), ...(byMonth.get(month)?.evidenceIds ?? [])])] });
      const applied = frozen.get(month)?.correction[metric] ?? 0;
      if (applied) out.push({ month, metric, before: applied, after: 0, delta: -applied, kind: "alreadyApplied", evidenceIds: frozen.get(month)?.evidenceIds ?? [] });
    }
  }
  return out;
}
