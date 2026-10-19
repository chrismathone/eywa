import { describe, expect, it } from "vitest";
import { calculateKpis, monthlyKpis } from "./calc";
import { normalizeData } from "./normalize";
import { SAMPLE_CSV } from "./sample";
import { sampleOptions } from "./test-fixtures";
import type { AnalysisData } from "./contract";

const period = { from: "2026-09-01", to: "2026-09-30" };
const empty = (): AnalysisData => ({ enrollments: [], payments: [], consultations: [] });
describe("management KPI definitions", () => {
  it("reconciles a synthetic month, excludes reentry/newcomer duplication and repeated receipts", () => {
    const { data, quality, issueCount } = normalizeData(SAMPLE_CSV, sampleOptions());
    expect(issueCount).toBe(0);
    expect(quality.payments).toEqual({ rows: 6, accepted: 5, duplicates: 1 });
    expect(calculateKpis(data, period)).toEqual({ active: 4, newcomers: 2, withdrawals: 1, receipts: 1150000, refunds: 100000, netReceipts: 1050000, prospects: 3, converted: 2, conversionRate: 2 / 3 * 100 });
  });
  it("has genuine zeros and an unavailable rate for no first consultations", () => {
    expect(calculateKpis(empty(), period)).toEqual({ active: 0, newcomers: 0, withdrawals: 0, receipts: 0, refunds: 0, netReceipts: 0, prospects: 0, converted: 0, conversionRate: null });
  });
  it("uses an exclusive withdrawal boundary and deduplicates students across multiple exits", () => {
    const data = empty();
    data.enrollments = [
      { studentId: "a", startedOn: "2026-08-01", endedOn: "2026-09-01" },
      { studentId: "a", startedOn: "2026-09-05", endedOn: "2026-09-30" },
      { studentId: "b", startedOn: "2026-09-30", endedOn: null },
      { studentId: "c", startedOn: "2026-10-01", endedOn: null },
    ];
    expect(calculateKpis(data, period)).toMatchObject({ active: 1, newcomers: 1, withdrawals: 1 });
  });
  it("counts first consultations once, excludes earlier cohorts and existing students, and avoids future conversion", () => {
    const data = empty();
    data.consultations = [
      { consultationId: "1", studentId: "a", consultedOn: "2026-08-31" },
      { consultationId: "2", studentId: "a", consultedOn: "2026-09-01" },
      { consultationId: "3", studentId: "b", consultedOn: "2026-09-01" },
      { consultationId: "4", studentId: "c", consultedOn: "2026-09-30" },
      { consultationId: "5", studentId: "d", consultedOn: "2026-09-01" },
    ];
    data.enrollments = [
      { studentId: "a", startedOn: "2026-09-01", endedOn: null },
      { studentId: "b", startedOn: "2026-10-01", endedOn: null },
      { studentId: "c", startedOn: "2026-09-30", endedOn: null },
      { studentId: "d", startedOn: "2026-08-31", endedOn: null },
    ];
    expect(calculateKpis(data, period)).toMatchObject({ prospects: 2, converted: 1, conversionRate: 50 });
  });
  it("allows negative net cash and counts only period transaction dates", () => {
    const data = empty();
    data.payments = [
      { transactionId: "a", studentId: "s", paidOn: "2026-08-31", amount: 300, kind: "payment" },
      { transactionId: "b", studentId: "s", paidOn: "2026-09-30", amount: 300, kind: "refund" },
      { transactionId: "c", studentId: "s", paidOn: "2026-10-01", amount: 100, kind: "payment" },
    ];
    expect(calculateKpis(data, period)).toMatchObject({ receipts: 0, refunds: 300, netReceipts: -300 });
  });
  it("clips partial months and crosses year and leap-day boundaries", () => {
    const data = empty();
    data.enrollments = [{ studentId: "a", startedOn: "2024-02-29", endedOn: null }];
    data.payments = [{ transactionId: "a", studentId: "a", paidOn: "2024-03-10", amount: 50, kind: "payment" }];
    const months = monthlyKpis(data, { from: "2023-12-15", to: "2024-03-05" });
    expect(months.map((m) => m.month)).toEqual(["2023-12", "2024-01", "2024-02", "2024-03"]);
    expect(months[2]).toMatchObject({ active: 1, newcomers: 1 });
    expect(months[3]).toMatchObject({ active: 1, newcomers: 0, receipts: 0 });
  });
});
