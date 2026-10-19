import type { AnalysisData, Kpis, Period } from "./contract";

/** Date-only KST business dates; withdrawal day is the first inactive day. */
export function calculateKpis(data: AnalysisData, { from, to }: Period): Kpis {
  const within = (d: string) => d >= from && d <= to;
  const firstEnrollment = new Map<string, string>();
  const active = new Set<string>(), withdrawals = new Set<string>();
  for (const e of data.enrollments) {
    if (!firstEnrollment.has(e.studentId) || e.startedOn < firstEnrollment.get(e.studentId)!) firstEnrollment.set(e.studentId, e.startedOn);
    if (e.startedOn <= to && (!e.endedOn || e.endedOn > to)) active.add(e.studentId);
    if (e.endedOn && within(e.endedOn)) withdrawals.add(e.studentId);
  }
  const firstConsultation = new Map<string, string>();
  for (const c of data.consultations) {
    if (!firstConsultation.has(c.studentId) || c.consultedOn < firstConsultation.get(c.studentId)!) firstConsultation.set(c.studentId, c.consultedOn);
  }
  let prospects = 0, converted = 0, receipts = 0, refunds = 0;
  for (const [studentId, date] of firstConsultation) {
    const enrollment = firstEnrollment.get(studentId);
    if (!within(date) || (enrollment && enrollment < date)) continue;
    prospects++;
    if (enrollment && enrollment >= date && enrollment <= to) converted++;
  }
  for (const p of data.payments) {
    if (!within(p.paidOn)) continue;
    if (p.kind === "refund") refunds += p.amount;
    else receipts += p.amount;
  }
  return {
    active: active.size, newcomers: [...firstEnrollment.values()].filter(within).length,
    withdrawals: withdrawals.size, receipts, refunds, netReceipts: receipts - refunds,
    prospects, converted, conversionRate: prospects === 0 ? null : converted / prospects * 100,
  };
}

export function monthlyKpis(data: AnalysisData, period: Period) {
  const result: (Kpis & { month: string })[] = [];
  let cursor = `${period.from.slice(0, 7)}-01`;
  while (cursor <= period.to) {
    const d = new Date(`${cursor}T00:00:00Z`);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    result.push({ month: cursor.slice(0, 7), ...calculateKpis(data, { from: cursor < period.from ? period.from : cursor, to: end > period.to ? period.to : end }) });
    cursor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
  }
  return result;
}
