import { classInvoiceAmount, type LineItemLike } from "@/features/billing/session-terms/class-amount";
import { effectiveAllocations, receiptLines } from "@/features/billing/session-terms/receipt-allocation";
import { rowKey } from "./grid/model";

export type AttendanceInvoice = { id: string; student_id: string; line_items: unknown };
export type AttendanceBillingTerm = {
  id: string;
  invoice_id: string;
  class_id: string | null;
  amount: number | null;
  confirmed_sessions: number | null;
  allocation_line_index: number | null;
  allocation_amount: number | null;
  allocation_source: unknown;
  allocation_base_amount: number | null;
};
export type AttendanceBillingClass = { classId: string; className: string; studentIds: readonly string[] };

/** 회차 확정의 '이 반 청구액'과 동일: 유효한 배분 우선, 없으면 반 이름 매칭. */
export function attendanceClassBilledAmounts(
  classes: readonly AttendanceBillingClass[],
  invoices: readonly AttendanceInvoice[],
  terms: readonly AttendanceBillingTerm[],
): Record<string, number> {
  const classById = new Map(classes.map((c) => [c.classId, { ...c, students: new Set(c.studentIds) }]));
  const termsByInvoice = new Map<string, AttendanceBillingTerm[]>();
  for (const term of terms) {
    const rows = termsByInvoice.get(term.invoice_id) ?? [];
    rows.push(term);
    termsByInvoice.set(term.invoice_id, rows);
  }
  const out: Record<string, number> = {};
  for (const invoice of invoices) {
    const invoiceTerms = termsByInvoice.get(invoice.id) ?? [];
    // 같은 청구 항목을 나누는 다른 반까지 검증한 뒤 표시할 반만 고른다.
    const allocated = effectiveAllocations(receiptLines(invoice.line_items), invoiceTerms.map((term) => ({
      id: term.id,
      amount: term.amount === null ? null : Number(term.amount),
      confirmedSessions: term.confirmed_sessions,
      lineIndex: term.allocation_line_index ?? null,
      allocatedAmount: term.allocation_amount == null ? null : Number(term.allocation_amount),
      source: term.allocation_source,
      baseAmount: term.allocation_base_amount == null ? null : Number(term.allocation_base_amount),
    })));
    const lineItems = (Array.isArray(invoice.line_items) ? invoice.line_items : []) as LineItemLike[];
    for (const term of invoiceTerms) {
      const cls = term.class_id ? classById.get(term.class_id) : undefined;
      if (!cls?.students.has(invoice.student_id)) continue;
      const amount = allocated.get(term.id) ?? classInvoiceAmount(cls.className, lineItems);
      if (amount === null) continue;
      const key = rowKey(cls.classId, invoice.student_id);
      out[key] = (out[key] ?? 0) + amount;
    }
  }
  return out;
}
