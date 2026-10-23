import { METRICS, emptyRaws, type Raws } from "./config";
import { assertRaws, reconcileMonth, sumRaws, type MonthRaws } from "./calc";
import type { BillingMonth } from "./billing";
import type { ReferralCredit } from "./referrals";

export type ContributionFact = { studentId: string; month: string; raws: Raws; evidenceIds: string[] };

/** 근거 수치 하나를 여러 소비처가 같은 방식으로 사용한다. 금액/건수에 배점은 입히지 않는다. */
export function contributionFacts(billing: readonly BillingMonth[], referrals: readonly ReferralCredit[], participation: readonly ContributionFact[]) {
  const facts: ContributionFact[] = [...billing, ...participation];
  for (const referral of referrals) {
    facts.push({ studentId: referral.referrerId, month: referral.consultedOn.slice(0, 7),
      raws: { ...emptyRaws(), referralConsult: 1 }, evidenceIds: [`consultation:${referral.consultationId}:${referral.subject}`] });
    if (referral.startedOn) facts.push({ studentId: referral.referrerId, month: referral.startedOn.slice(0, 7),
      raws: { ...emptyRaws(), referralStarted: 1 }, evidenceIds: [`started:${referral.consultationId}:${referral.subject}`] });
  }
  const merged = new Map<string, ContributionFact>();
  for (const fact of facts) {
    assertRaws(fact.raws);
    const key = `${fact.studentId}\0${fact.month}`;
    const before = merged.get(key);
    merged.set(key, before ? { ...before, raws: sumRaws([before.raws, fact.raws]),
      evidenceIds: [...new Set([...before.evidenceIds, ...fact.evidenceIds])] } : { ...fact, raws: { ...fact.raws }, evidenceIds: [...fact.evidenceIds] });
  }
  return [...merged.values()].sort((a, b) => a.studentId.localeCompare(b.studentId) || a.month.localeCompare(b.month));
}

export type BuiltMonth = MonthRaws & { evidenceIds: string[]; reconstructed: boolean };
/** 최초 집계는 과거 달에 원래 실적을 채운다. 이후에는 마감 행을 그대로 두고 현재 달에 정정만 쌓는다. */
export function buildStudentMonths(input: { month: string; capturedAt: string; facts: readonly ContributionFact[];
  stored: readonly BuiltMonth[]; complete: boolean; reconstruct?: boolean }): BuiltMonth[] {
  if (!input.complete) throw new Error("기여도 원자료를 모두 확인한 뒤 집계할 수 있습니다");
  const facts = input.facts.filter((f) => f.month <= input.month);
  if (new Set(facts.map((f) => f.studentId)).size > 1) throw new Error("One student's facts are required");
  const byMonth = new Map<string, ContributionFact>();
  for (const fact of facts) {
    const previous = byMonth.get(fact.month);
    byMonth.set(fact.month, previous ? { ...fact, raws: sumRaws([previous.raws, fact.raws]), evidenceIds: [...new Set([...previous.evidenceIds, ...fact.evidenceIds])] } : fact);
  }
  if (!input.stored.length) {
    if (!byMonth.has(input.month)) byMonth.set(input.month, { studentId: facts[0]?.studentId ?? "", month: input.month, raws: emptyRaws(), evidenceIds: [] });
    return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((f) => ({ month: f.month, raws: { ...f.raws }, correction: emptyRaws(),
      closedAt: f.month < input.month ? input.capturedAt : null, evidenceIds: [...f.evidenceIds], reconstructed: f.month < input.month }));
  }
  // 지난달의 개근·영상 완료는 달이 끝난 뒤에야 판정된다. 열린 달은 마지막으로 집계한 뒤 마감한다.
  // 이미 마감한 달은 그대로 보존하고 그 뒤에 바뀐 사실만 열린 달 정정으로 보낸다.
  const closed: BuiltMonth[] = [];
  const previous = [...input.stored];
  for (const fact of byMonth.values()) {
    // 최초 집계 뒤 새로 들어온 과거 달도 원본 근거를 열 수 있게 남긴다.
    // 과거 실적을 새로 확정하지 않고 0으로 두어, 실제 수치는 이번 달 정정에만 반영한다.
    if (fact.month < input.month && !previous.some((r) => r.month === fact.month)) previous.push({ month: fact.month,
      raws: input.reconstruct ? fact.raws : emptyRaws(), correction: emptyRaws(), closedAt: input.capturedAt,
      evidenceIds: fact.evidenceIds, reconstructed: !!input.reconstruct });
  }
  for (const stored of previous.filter((m) => m.month < input.month).sort((a, b) => a.month.localeCompare(b.month))) {
    if (stored.closedAt) { closed.push(stored); continue; }
    const fact = byMonth.get(stored.month);
    const closing = reconcileMonth({ month: stored.month, closed, currentFacts: fact?.raws ?? emptyRaws(),
      todayTotals: sumRaws(facts.filter((f) => f.month <= stored.month).map((f) => f.raws)) });
    closed.push({ ...closing, closedAt: input.capturedAt, evidenceIds: fact?.evidenceIds ?? [], reconstructed: stored.reconstructed });
  }
  const current = byMonth.get(input.month);
  const row = reconcileMonth({ month: input.month, closed, currentFacts: current?.raws ?? emptyRaws(), todayTotals: sumRaws(facts.map((f) => f.raws)) });
  const changed = METRICS.some((id) => row.correction[id] !== 0);
  return [...closed, { ...row, evidenceIds: [...new Set([...(current?.evidenceIds ?? []), ...(changed ? facts.flatMap((f) => f.evidenceIds) : [])])], reconstructed: false }];
}
