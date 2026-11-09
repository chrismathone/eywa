import { z } from "zod";
import type { ReviewBatch } from "./reviews";
import type { reportedFinancialView } from "./reported-financials";

/**
 * 경영 분석 시안의 순수 모델 — aywa-next(375d27df4) `features/management/model.ts`에서 화면이 쓰는 부분만.
 * 청구 원장 집계(invoiceMetrics)·DB 저장 스키마 검증은 옮기지 않았다(시안은 예시 값만 그린다).
 */
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const accountCategories = ["revenue", "labor", "marketing", "rent", "operating", "nonoperating", "exclude"] as const;
export type AccountCategory = typeof accountCategories[number];
export const categoryLabels: Record<AccountCategory, string> = { revenue: "매출", labor: "인건비", marketing: "광고·행사비", rent: "임차료", operating: "기타 영업비용", nonoperating: "영업외·법인세", exclude: "집계 제외" };

export type AccountingLine = { key: string; account: string; category: AccountCategory; amount: number; sourceCell: string };
export type AccountingReport = {
  company: string; start: string; end: string; sourceName: string; sourceHash: string; lines: AccountingLine[];
  reportedRevenue: number | null; reportedOperatingCost: number | null; reportedOperatingProfit: number | null;
  scopeConfirmed: true; complete: boolean; sourceKind?: "profit_loss" | "ledger";
  ledgerInfo?: { sourceStart: string; sourceEnd: string; accountCount: number; transactionCount: number; totalTransactionCount: number; controlsMatched: boolean; unclassifiedCodes: string[]; warnings: string[] };
};
export type StoredReport = { id: string; version: number; document: AccountingReport; updated_at: string };
export type Metric = { id: string; label: string; value: number | null; unit: "원" | "명" | "건" | "%"; definition: string; source: string; href: string };
export type InvoiceSummary = { count: number; gross: number; discount: number; net: number; collected: number; outstanding: number; students: number; perStudent: number | null };

export function periodBounds(month: string) {
  monthSchema.parse(month);
  const [y, m] = month.split("-").map(Number);
  return { start: `${month}-01`, end: new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10), previous: new Date(Date.UTC(y!, m! - 2, 1)).toISOString().slice(0, 7) };
}
export function accountingTotals(report: AccountingReport) {
  const sum = (categories: readonly string[]) => report.lines.filter(l => categories.includes(l.category)).reduce((s, l) => s + l.amount, 0);
  const revenue = sum(["revenue"]), labor = sum(["labor"]), cost = sum(["labor", "marketing", "rent", "operating"]);
  const checks = {
    revenue: report.reportedRevenue === null ? null : revenue - report.reportedRevenue,
    cost: report.reportedOperatingCost === null ? null : cost - report.reportedOperatingCost,
    profit: report.reportedOperatingProfit === null ? null : revenue - cost - report.reportedOperatingProfit,
  };
  const reconciled = Object.values(checks).every(x => x === 0);
  const ready = report.complete && report.scopeConfirmed && reconciled;
  return { revenue, labor, cost, marketing: sum(["marketing"]), profit: ready ? revenue - cost : null, margin: ready && revenue > 0 ? (revenue - cost) / revenue * 100 : null, laborRatio: ready && revenue > 0 ? labor / revenue * 100 : null, ready, reconciled, checks };
}
/** Exact symmetric decomposition: delta(N*P) = delta(N)*avg(P) + delta(P)*avg(N). Descriptive, not causal. */
export function revenueBridge(previous: InvoiceSummary, current: InvoiceSummary) {
  if (previous.perStudent === null || current.perStudent === null) return null;
  return {
    delta: current.net - previous.net,
    studentsEffect: (current.students - previous.students) * (current.perStudent + previous.perStudent) / 2,
    perStudentEffect: (current.perStudent - previous.perStudent) * (current.students + previous.students) / 2,
  };
}
export function hiringScenario(input: { revenue: number; cost: number; labor: number; additionalMonthlyCost: number; additionalStudents: number; netFee: number; variableCostPerStudent: number; targetMargin: number }) {
  if (Object.values(input).some(x => !Number.isFinite(x)) || input.revenue <= 0 || input.additionalMonthlyCost < 0 || input.additionalStudents < 0 || !Number.isInteger(input.additionalStudents) || input.netFee < 0 || input.variableCostPerStudent < 0 || input.targetMargin < 0 || input.targetMargin >= 100) throw Error("채용 가정을 확인해 주세요");
  const contribution = input.netFee - input.variableCostPerStudent;
  const revenue = input.revenue + input.additionalStudents * input.netFee;
  const cost = input.cost + input.additionalMonthlyCost + input.additionalStudents * input.variableCostPerStudent;
  const targetDenominator = contribution - input.netFee * input.targetMargin / 100;
  const need = cost - input.additionalStudents * input.variableCostPerStudent - input.revenue * (1 - input.targetMargin / 100);
  return {
    profit: revenue - cost, margin: (revenue - cost) / revenue * 100, laborRatio: (input.labor + input.additionalMonthlyCost) / revenue * 100,
    breakEvenNewStudents: contribution > 0 ? Math.ceil(input.additionalMonthlyCost / contribution) : null,
    studentsForTarget: targetDenominator > 0 ? Math.max(0, Math.ceil(need / targetDenominator)) : null,
  };
}
export type KnowledgeGraph = { schemaVersion: string; observedAt: string; nodes: { id: string; type: string; label: string; source: string; href?: string; value?: number | null; period?: string; state?: string; recordedAt?: string; detail?: string }[]; edges: { from: string; relation: string; to: string; basis: string }[] };
export type ManagementSnapshot = {
  month: string; asOf: string; observedAt: string; metrics: Metric[];
  current: InvoiceSummary; previous: InvoiceSummary; bridge: ReturnType<typeof revenueBridge>;
  reports: StoredReport[]; accounting: ReturnType<typeof accountingTotals> | null;
  reportedFinancials: ReturnType<typeof reportedFinancialView>;
  sources: { name: string; state: string; updatedAt: string | null; note: string }[];
  teachers: { id: string; label: string; students: number; courses: number }[];
  channels: { label: string; inquiries: number; registered: number }[];
  graph: KnowledgeGraph; reviewBatches: ReviewBatch[];
};
