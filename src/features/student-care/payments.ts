import { receiptOriginalItems } from "@/features/billing/session-terms/receipt-refund";
import { isTuitionReceipt } from "@/features/billing/session-terms/tuition-receipt";
import { isValidYm } from "@/lib/date-kst";
import type { Invoice } from "./types";

const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const money = (v: unknown): number | null => {
  if (v == null || (typeof v === "string" && !v.trim()) || !["number", "string"].includes(typeof v)) return null;
  const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : null;
};
/** `paid` is the source's recorded payment. Refund netting is not specified by this schema. */
export function paymentsOf(rows: readonly Invoice[]) {
  const seen = new Map<string, Invoice>();
  let conflict = false;
  for (const row of rows) {
    const prior = seen.get(row.id);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) conflict = true;
    seen.set(row.id, row);
  }
  let paid = 0, tuitionPaid = 0, refunds = 0, tuitionLines = 0, unknownLines = 0, refundUnknown = false, activeRefund = false;
  const periods: string[] = [];
  for (const invoice of seen.values()) {
    if (invoice.status === "void") continue;
    const amount = money(invoice.amount_paid);
    if (amount == null) conflict = true; else paid += amount;
    if (isValidYm(invoice.period)) periods.push(invoice.period);
    const items = Array.isArray(invoice.line_items) ? invoice.line_items.flatMap(receiptOriginalItems) : [];
    if (!items.length) { unknownLines++; continue; }
    let lineTotal = 0, completeLines = true;
    for (const item of items) {
      const row = object(item), value = money(row.paid);
      if (value == null) completeLines = false; else lineTotal += value;
      if (typeof row.kind !== "string" || !row.kind.trim()) { unknownLines++; continue; }
      // Reuse the program/material exclusion, without excluding partially refunded tuition.
      if (!isTuitionReceipt({ ...row, refunds: [] })) continue;
      if (value == null) { unknownLines++; continue; }
      tuitionPaid += value; tuitionLines++;
      if (!Array.isArray(row.refunds)) { refundUnknown = true; continue; }
      for (const rawRefund of row.refunds) {
        const refund = object(rawRefund);
        if (refund.status === "cancelled") continue;
        const refundAmount = money(refund.amount);
        if (refund.status !== "active" || refundAmount == null) { refundUnknown = true; continue; }
        activeRefund = true; refunds += refundAmount;
      }
    }
    if (!completeLines || amount == null || lineTotal !== amount) conflict = true;
    if (invoice.status === "refunded") refundUnknown = true;
  }
  const count = [...seen.values()].filter((r) => r.status !== "void").length;
  const known = count > 0 && !conflict;
  return { count, from: periods.sort()[0] ?? null, to: periods.at(-1) ?? null,
    recordedPaid: known ? paid : null,
    tuitionPaid: known && tuitionLines > 0 ? tuitionPaid : null,
    recordedRefunds: known && tuitionLines > 0 && !refundUnknown ? refunds : null,
    // Do not subtract refunds twice: only a verified no-refund set has a net value in this MVP.
    netTuition: known && tuitionLines > 0 && !refundUnknown && !activeRefund && unknownLines === 0 ? tuitionPaid : null,
    unknownLines, conflict, refundUnknown, activeRefund };
}
