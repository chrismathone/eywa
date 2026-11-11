import { z } from "zod";
import type { ReviewBatch } from "./reviews";
import type { reportedFinancialView } from "./reported-financials";

/**
 * 경영 분석의 순수 모델 — aywa-next(375d27df4) `features/management/model.ts`. 서버(저장 검증)·화면이 같이 쓴다.
 * 회계 자료 스키마는 DB 저장 함수(s2_0052 save_management_accounting)의 검사와 짝이다.
 */
export const monthSchema = z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/);
export const dateSchema = z.iso.date();
export const accountCategories = ["revenue", "labor", "marketing", "rent", "operating", "nonoperating", "exclude"] as const;
export type AccountCategory = typeof accountCategories[number];
export const categoryLabels: Record<AccountCategory, string> = { revenue: "매출", labor: "인건비", marketing: "광고·행사비", rent: "임차료", operating: "기타 영업비용", nonoperating: "영업외·법인세", exclude: "집계 제외" };

export const accountingLineSchema = z.object({
  key: z.string().min(1).max(120), account: z.string().min(1).max(160),
  category: z.enum(accountCategories), amount: z.number().int().min(-1e12).max(1e12),
  sourceCell: z.string().min(1).max(120),
  // 원장 집계 줄만: 차변·대변 원액과 **원본 계정의 방향**(가져올 때 정해지고 바뀌지 않는다) — 분류를 바꾸면 이 원액에서 금액을 다시 계산한다(`lineAmount`).
  debit: z.number().int().min(-1e12).max(1e12).optional(), credit: z.number().int().min(-1e12).max(1e12).optional(),
  normal: z.enum(["debit", "credit"]).optional(),
}).strict();
type LedgerSide = { category: AccountCategory; debit?: number; credit?: number; normal?: "debit" | "credit" };
/** 그 분류에서 금액을 읽는 쪽 — 매출은 대변, 비용(인건비·광고·임차·기타)은 차변. 영업외·집계 제외는 원본 계정의 방향(`normal`) 그대로. */
export function normalSideOf(line: LedgerSide): "debit" | "credit" {
  if (line.category === "revenue") return "credit";
  if (line.category === "nonoperating" || line.category === "exclude") return line.normal ?? "debit";
  return "debit";
}
/** 원액이 있는 줄(원장 집계)의 금액 = 정상잔액 방향의 순액. 원액이 없는 줄(손익계산서)은 null — 적힌 금액을 그대로 쓴다. */
export function lineAmount(line: LedgerSide): number | null {
  if (line.debit === undefined || line.credit === undefined) return null;
  return normalSideOf(line) === "credit" ? line.credit - line.debit : line.debit - line.credit;
}
/**
 * 분류를 바꾼 줄 — 원액이 있으면 새 분류의 방향으로 금액을 다시 계산한다(미분류 대변 매출 100 → 매출로 바꾸면 +100 · 비용이면 −100).
 * 원본 방향(`normal`)은 건드리지 않는다 — 분류를 여러 번 오가도 같은 분류면 같은 금액이다.
 */
export function reclassifyLine<T extends LedgerSide & { amount: number }>(line: T, category: AccountCategory): T {
  const next = { ...line, category };
  const amount = lineAmount(next);
  return amount === null ? next : { ...next, amount };
}
export const accountingSchema = z.object({
  company: z.string().trim().min(1).max(160), start: dateSchema, end: dateSchema,
  sourceName: z.string().min(1).max(200), sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  lines: z.array(accountingLineSchema).min(1).max(2000),
  reportedRevenue: z.number().int().nullable(), reportedOperatingCost: z.number().int().nullable(),
  reportedOperatingProfit: z.number().int().nullable(),
  scopeConfirmed: z.literal(true), complete: z.boolean(),
  sourceKind: z.enum(["profit_loss", "ledger"]).optional(),
  ledgerInfo: z.object({
    sourceStart: dateSchema, sourceEnd: dateSchema, accountCount: z.number().int().nonnegative(),
    transactionCount: z.number().int().nonnegative(), totalTransactionCount: z.number().int().nonnegative(),
    controlsMatched: z.boolean(), unclassifiedCodes: z.array(z.string().max(20)).max(500),
    warnings: z.array(z.string().max(300)).max(20),
  }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.start > v.end) ctx.addIssue({ code: "custom", message: "기간 순서를 확인해 주세요" });
  if (new Set(v.lines.map(l => l.key)).size !== v.lines.length) ctx.addIssue({ code: "custom", message: "중복 원본 행이 있습니다" });
  if (v.complete && [v.reportedRevenue, v.reportedOperatingCost, v.reportedOperatingProfit].some(x => x === null)) ctx.addIssue({ code: "custom", message: "완전한 손익 자료에는 원본 매출·영업비용·영업이익 합계가 필요합니다" });
  if (v.lines.some(l => (l.debit === undefined) !== (l.credit === undefined) || (lineAmount(l) !== null && lineAmount(l) !== l.amount))) ctx.addIssue({ code: "custom", message: "원장 금액이 차변·대변 원액과 맞지 않습니다. 파일을 다시 가져와 주세요" });
  if (v.sourceKind === "ledger" && (!v.ledgerInfo || v.complete)) ctx.addIssue({ code: "custom", message: "원장 집계는 원본 정보와 함께 검토 대기로 저장해야 합니다" });
});
export type AccountingLine = z.infer<typeof accountingLineSchema>;
export type AccountingReport = z.infer<typeof accountingSchema>;
export type AccountingDraft = Omit<AccountingReport, "scopeConfirmed"> & { scopeConfirmed: boolean };
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
  /** 예시 화면(sample-data)만 채운다 — 실제 조회는 그래프를 만들지 않는다. */
  graph?: KnowledgeGraph; reviewBatches: ReviewBatch[];
};
/** 저장된 회계 자료 전 기간의 버전 색인(본문 없이) — 저장할 때 기대 버전을 여기서 찾는다. */
export type ReportIndexRow = { start: string; end: string; kind: "ledger" | "profit_loss"; version: number };
