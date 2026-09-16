"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { getSessionTermsView, type SessionTermRow } from "./queries";
import { receiptLines, type ReceiptLine } from "../receipt-allocation";

export type ReceiptAllocationView = { lines: ReceiptLine[]; source: unknown; terms: SessionTermRow[] };
export type ReceiptAllocationInput = { termId: string; lineIndex: number; amount: number; baseAmount: number; confirmedAt: string };

export async function getReceiptAllocation(invoiceId: string): Promise<{ data?: ReceiptAllocationView; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  const db = await createClient();
  const { data: invoice, error } = await db.from("invoices").select("period, line_items").eq("id", invoiceId).neq("status", "void").maybeSingle();
  if (error) return { error: error.message };
  if (!invoice) return { error: "청구서를 찾을 수 없습니다" };
  const view = await getSessionTermsView(invoice.period, invoiceId);
  return { data: { lines: receiptLines(invoice.line_items).filter((line) => ["", "수업", "tuition", "수강료"].includes(line.kind)), source: invoice.line_items, terms: view.rows } };
}

export async function saveReceiptAllocation(invoiceId: string, source: unknown, rows: ReceiptAllocationInput[]): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (!Array.isArray(rows) || rows.length > 500 || rows.some((row) => !Number.isSafeInteger(row.amount) || row.amount < 0 || !Number.isInteger(row.lineIndex) || row.lineIndex < 0)) return { error: "배분금액과 연결 항목을 확인해 주세요" };
  const db = await createClient();
  const { error } = await db.rpc("save_session_receipt_allocations", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows });
  if (error) return { error: error.message };
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_receipt_allocate", targetType: "invoice", metadata: { invoiceId, basis: "gross_bill", allocations: rows } });
  });
  return { ok: true };
}
