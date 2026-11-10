import { invoiceOutstanding } from "@/features/billing/calc";
import type { InvoiceSummary } from "./model";

/** 경영 분석이 DB에서 읽는 줄 모양 — `server/query.ts`의 select 칸과 짝. */
export type Invoice = { id: string; student_id: string; period: string; amount_total: number | string; amount_paid: number | string; amount_discount: number | string | null; status: string; category: string | null; updated_at: string };
export type Student = { id: string; makeedu_id: string | null; name: string; notes: string | null; school: string | null; grade: string | null; is_test: boolean | null; status: string; enrolled_at: string | null; withdrawn_at: string | null };
export type Enrollment = { id: string; student_id: string; class_id: string; start_date: string | null; end_date: string | null; on_hold: boolean; is_transferred: boolean };
export type ClassRow = { id: string; class_name: string; subject: string; teacher_id: string | null; is_makeup_pool: boolean };

/**
 * 청구월 집계 — 같은 청구서는 한 번만 · 무효(void) 제외. 미수 잔액은 수납관리와 같은 공식(`invoiceOutstanding`).
 * collected = 그 달 청구서에 지금까지 들어온 수납액(그 달 입금 합계가 아니다).
 */
export function invoiceMetrics(rows: Invoice[]): InvoiceSummary {
  const unique = [...new Map(rows.map(r => [r.id, r])).values()].filter(r => r.status !== "void");
  const mapped = unique.map(r => ({ amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount ?? 0), status: r.status }));
  if (mapped.some(r => [r.amountTotal, r.amountPaid, r.amountDiscount].some(v => !Number.isFinite(v)))) throw Error("청구 금액 형식을 확인하지 못했습니다");
  const gross = mapped.reduce((s, r) => s + r.amountTotal, 0), discount = mapped.reduce((s, r) => s + r.amountDiscount, 0);
  const students = new Set(unique.filter(r => Number(r.amount_total) - Number(r.amount_discount ?? 0) > 0).map(r => r.student_id)).size;
  const net = gross - discount;
  return {
    count: unique.length, gross, discount, net,
    collected: mapped.reduce((s, r) => s + r.amountPaid, 0),
    outstanding: mapped.reduce((s, r) => s + invoiceOutstanding(r), 0),
    students, perStudent: students > 0 ? net / students : null,
  };
}
