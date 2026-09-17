"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { getSessionTermsView, type SessionTermRow } from "./queries";
import { receiptLines, type ReceiptLine } from "../receipt-allocation";
import { enrollmentPeriodLabel } from "../receipt-merge";
import { monthRange } from "../plan";
import { suggestReceiptAllocations, type ReceiptSuggestion } from "../receipt-suggestion";
import { isTuitionReceipt } from "../tuition-receipt";

export type ReceiptAllocationView = { period?: string; lines: ReceiptLine[]; source: unknown; suggestions?: ReceiptSuggestion[]; terms: (SessionTermRow & { enrollmentLabel?: string })[] };
export type ReceiptAllocationInput = { termId: string; lineIndex: number; amount: number; baseAmount: number | null; confirmedAt: string | null };

export async function getReceiptAllocation(invoiceId: string): Promise<{ data?: ReceiptAllocationView; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  const db = await createClient();
  const { data: invoice, error } = await db.from("invoices").select("period, student_id, line_items").eq("id", invoiceId).neq("status", "void").maybeSingle();
  if (error) return { error: error.message };
  if (!invoice) return { error: "청구서를 찾을 수 없습니다" };
  const range = monthRange(invoice.period);
  if (!range) return { error: "청구월을 확인해 주세요" };
  const view = await getSessionTermsView(invoice.period, invoiceId);
  const enrollments = (view.enrollmentHistory ?? []).filter((e) => e.student_id === invoice.student_id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const lines = receiptLines(invoice.line_items).filter((line) => isTuitionReceipt(line.source));
  return { data: { period: invoice.period, lines, source: invoice.line_items, suggestions: suggestReceiptAllocations(invoice.period, lines, view.rows, enrollments.filter((e) => !e.on_hold)),
    terms: view.rows.map((term) => ({ ...term, enrollmentLabel: enrollmentPeriodLabel(invoice.period, enrollments.filter((e) => e.class_id === term.classId), today) })) } };
}

export async function mergeReceiptItems(invoiceId: string, source: unknown, indices: number[], label: string, removeId?: string): Promise<{ data?: ReceiptAllocationView; error?: string; committed?: boolean }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (!Array.isArray(indices) || indices.length > 50 || indices.some((i) => !Number.isSafeInteger(i) || i < 0)
    || typeof label !== "string" || label.length > 200 || (!removeId && (indices.length < 2 || !label.trim()))) return { error: "합산할 항목과 수납명을 확인해 주세요" };
  const db = await createClient();
  const { error } = await db.rpc("edit_receipt_merge_group", { p_invoice_id: invoiceId, p_expected_lines: source, p_indices: indices, p_label: label, p_remove_id: removeId ?? null });
  if (error) return { error: error.message };
  revalidatePath("/billing");
  try {
    const result = await getReceiptAllocation(invoiceId);
    if (result.data) return { data: result.data, committed: true };
  } catch { /* 저장은 완료됐지만 조회가 실패하면 오래된 화면에서 추가 저장하지 않는다. */ }
  return { committed: true, error: "수납 합산 변경은 저장됐습니다. 창을 다시 열어 확인해 주세요." };
}

export async function saveReceiptAllocation(invoiceId: string, source: unknown, rows: ReceiptAllocationInput[]): Promise<{ ok?: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (!Array.isArray(rows) || rows.length > 500 || rows.some((row) => !Number.isSafeInteger(row.amount) || row.amount < 0 || !Number.isInteger(row.lineIndex) || row.lineIndex < 0)) return { error: "배분금액과 연결 항목을 확인해 주세요" };
  const eligible = new Set(receiptLines(source).filter((line) => isTuitionReceipt(line.source)).map((line) => line.index));
  if (rows.some((row) => !eligible.has(row.lineIndex))) return { error: "수업 청구액에만 배분할 수 있습니다" };
  const db = await createClient();
  const { error } = await db.rpc("save_session_receipt_allocations", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows });
  if (error) return { error: error.message };
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_receipt_allocate", targetType: "invoice", metadata: { invoiceId, basis: "gross_bill", allocations: rows } });
  });
  return { ok: true };
}
