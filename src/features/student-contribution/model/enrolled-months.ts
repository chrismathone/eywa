import type { BillingSeed } from "./billing";

/** Count eligible billed months after identity merging, independent of payment and subject count. */
export function enrolledMonthCounts(seeds: readonly Pick<BillingSeed, "studentId" | "month" | "active">[]) {
  const months = new Map<string, Set<string>>();
  for (const seed of seeds) {
    if (!seed.active) continue;
    const own = months.get(seed.studentId) ?? new Set<string>();
    own.add(seed.month); months.set(seed.studentId, own);
  }
  return new Map([...months].map(([id, own]) => [id, own.size]));
}
