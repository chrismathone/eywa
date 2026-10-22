import { METRICS, OPERATION_METRICS, emptyRaws, type ContributionConfig, type Raws } from "./config";

/** 원래 수치는 건수/원 단위 정수. 환불·정정은 음수이며 오류/조회 실패를 0으로 바꾸지 않는다. */
export function assertRaws(raws: Raws): void {
  for (const id of METRICS) if (!Number.isSafeInteger(raws[id])) throw new RangeError(`Invalid contribution raw: ${id}`);
}
export function sumRaws(rows: readonly Raws[]): Raws {
  const total = emptyRaws();
  for (const row of rows) {
    assertRaws(row);
    for (const id of METRICS) total[id] += row[id];
  }
  assertRaws(total);
  return total;
}

/** 월별 점수의 반올림 합이 아니라, 모든 달 원래 수치 합에 현재 배점을 한 번 적용한다. */
export function scoreRaws(raws: Raws, config: ContributionConfig) {
  assertRaws(raws);
  const points = emptyRaws();
  let operations = 0;
  let participation = 0;
  for (const id of METRICS) {
    const rate = config.rates[id];
    if (!Number.isFinite(rate.points) || rate.points < 0) throw new RangeError("Invalid contribution rate");
    points[id] = rate.enabled ? raws[id] * rate.points / (id === "tuitionWon" ? 100_000 : 1) : 0;
    if (!Number.isFinite(points[id])) throw new RangeError("Contribution score overflow");
    if (OPERATION_METRICS.includes(id)) operations += points[id]; else participation += points[id];
  }
  const total = operations + participation;
  if (!Number.isFinite(total)) throw new RangeError("Contribution total overflow");
  return { points, operations, participation, total };
}

export type MonthRaws = { month: string; raws: Raws; correction: Raws; closedAt: string | null };
/** D5: 마감 행은 건드리지 않고, 과거 사실 변화는 이번 달 정정으로 남긴다. 현재 달 재실행도 같은 값이다. */
export function reconcileMonth(input: { month: string; todayTotals: Raws; currentFacts: Raws; closed: readonly MonthRaws[] }) {
  if (input.closed.some((row) => !row.closedAt || row.month >= input.month)) throw new Error("Only earlier closed months may be reconciled");
  if (new Set(input.closed.map((row) => row.month)).size !== input.closed.length) throw new Error("Duplicate closed month");
  const closedTotal = sumRaws(input.closed.flatMap((row) => [row.raws, row.correction]));
  assertRaws(input.todayTotals);
  assertRaws(input.currentFacts);
  const correction = emptyRaws();
  for (const id of METRICS) correction[id] = input.todayTotals[id] - closedTotal[id] - input.currentFacts[id];
  assertRaws(correction);
  return { month: input.month, raws: { ...input.currentFacts }, correction, closedAt: null } satisfies MonthRaws;
}
