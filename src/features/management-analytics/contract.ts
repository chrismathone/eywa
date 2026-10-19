import { z } from "zod";

export const DATASETS = ["enrollments", "payments", "consultations"] as const;
export type Dataset = (typeof DATASETS)[number];
export const DATASET_LABELS: Record<Dataset, string> = {
  enrollments: "입퇴원 이력", payments: "수납·환불 거래", consultations: "최초 상담 이력",
};
export const FIELDS = {
  enrollments: { student_id: "학생 식별자", started_on: "입원일", ended_on: "퇴원일 (없으면 빈칸)" },
  payments: { transaction_id: "거래 식별자", student_id: "학생 식별자", paid_on: "거래일", amount: "금액 (양수 원)", kind: "구분 (수납/환불)" },
  consultations: { consultation_id: "상담 식별자", student_id: "학생 식별자", consulted_on: "상담일" },
} as const;
export type ColumnMapping = Record<Dataset, Record<string, string>>;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_ROWS = 10_000;

export function normalizeDate(value: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (!match) return null;
  const iso = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return Number(match[1]) >= 1900 && Number(match[1]) <= 2100 && !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => normalizeDate(v) === v);
export const analysisOptionsSchema = z.object({
  from: isoDate, to: isoDate, asOf: isoDate,
  completeHistory: z.literal(true), sameTenant: z.literal(true),
  encoding: z.enum(["utf-8", "euc-kr"]),
  mapping: z.object({
    enrollments: z.record(z.string(), z.string().max(100)),
    payments: z.record(z.string(), z.string().max(100)),
    consultations: z.record(z.string(), z.string().max(100)),
  }),
}).strict().refine((v) => v.from <= v.to && v.to <= v.asOf &&
  (Number(v.to.slice(0, 4)) - Number(v.from.slice(0, 4))) * 12 + Number(v.to.slice(5, 7)) - Number(v.from.slice(5, 7)) < 24);
export type AnalysisOptions = z.infer<typeof analysisOptionsSchema>;
export type Period = Pick<AnalysisOptions, "from" | "to">;
export type Enrollment = { studentId: string; startedOn: string; endedOn: string | null };
export type Payment = { transactionId: string; studentId: string; paidOn: string; amount: number; kind: "payment" | "refund" };
export type Consultation = { consultationId: string; studentId: string; consultedOn: string };
export type AnalysisData = { enrollments: Enrollment[]; payments: Payment[]; consultations: Consultation[] };
export type ValidationIssue = { dataset: Dataset; row: number; field: string; message: string };
export type Quality = Record<Dataset, { rows: number; accepted: number; duplicates: number }>;
export type Kpis = { active: number; newcomers: number; withdrawals: number; receipts: number; refunds: number; netReceipts: number; prospects: number; converted: number; conversionRate: number | null };
export type AnalysisReport = { period: Period; asOf: string; generatedAt: string; kpis: Kpis; months: (Kpis & { month: string })[]; quality: Quality };
export type AnalysisResult = { ok: true; report: AnalysisReport } | { ok: false; error: string; issues?: ValidationIssue[]; issueCount?: number };

export class AnalysisError extends Error {
  constructor(message: string, public readonly status = 422) { super(message); }
}
