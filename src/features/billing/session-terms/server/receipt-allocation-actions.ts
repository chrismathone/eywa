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
import { unlinkedZeroBlockers } from "../unlinked-zero";

export type ReceiptAllocationView = { period?: string; lines: ReceiptLine[]; source: unknown; suggestions?: ReceiptSuggestion[]; terms: (SessionTermRow & { enrollmentLabel?: string })[] };
/**
 * `lineIndex: null` = 연결할 수납 항목이 없는 확정 반을 0원으로 저장(0269a — 금액은 0만).
 * `ackUnlinked` = 어느 반에도 안 붙은 수업 항목이 남는다는 확인을 받았다(그런 항목이 있으면 0원 행에 필수).
 */
export type ReceiptAllocationInput = { termId: string; lineIndex: number | null; amount: number; baseAmount: number | null; confirmedAt: string | null; ackUnlinked?: boolean };

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
  if (!Array.isArray(rows) || rows.length > 500 || rows.some((row) => !Number.isSafeInteger(row.amount) || row.amount < 0 || (row.lineIndex === null ? row.amount !== 0 : !Number.isInteger(row.lineIndex) || row.lineIndex < 0))) return { error: "배분금액과 연결 항목을 확인해 주세요" };
  const eligible = new Set(receiptLines(source).filter((line) => isTuitionReceipt(line.source)).map((line) => line.index));
  if (rows.some((row) => row.lineIndex !== null && !eligible.has(row.lineIndex))) return { error: "수업 청구액에만 배분할 수 있습니다" };
  const db = await createClient();
  if (rows.some((row) => row.lineIndex === null)) {
    if (!rows.some((row) => row.lineIndex !== null)) return { error: "수납 항목에 한 반 이상 연결한 뒤 남은 반을 0원으로 저장할 수 있습니다" };
    // '연결 안 함 = 0원'은 빠뜨린 연결을 덮지 못한다 — 화면과 같은 함수로 다시 본다(#77). 확정 여부는 DB 함수가 다시 본다.
    const { data: termRows, error: termError } = await db
      .from("invoice_session_terms")
      .select("id, class_id, confirmed_sessions, class:class_id ( class_name )")
      .eq("invoice_id", invoiceId);
    if (termError || !termRows) return { error: "반 정보를 읽지 못했습니다. 다시 시도해 주세요" };
    const terms = (termRows as { id: string; class_id: string | null; confirmed_sessions: number | null; class: { class_name?: string | null } | { class_name?: string | null }[] | null }[]).map((t) => {
      const cls = Array.isArray(t.class) ? t.class[0] : t.class;
      return { id: t.id, classId: t.class_id, className: cls?.class_name ?? null, confirmedSessions: t.confirmed_sessions };
    });
    const draft = Object.fromEntries(rows.map((row) => [row.termId, { line: row.lineIndex === null ? "" : String(row.lineIndex), amount: String(row.amount) }]));
    const lines = receiptLines(source).filter((line) => isTuitionReceipt(line.source));
    const block = unlinkedZeroBlockers(lines, terms.filter((t) => t.id in draft), draft);
    if (block.matchedTerms.length) return { error: `${block.matchedTerms.map((t) => t.className ?? "반").join(", ")}에 맞는 수납 항목이 있습니다. 0원으로 두지 말고 연결해 주세요` };
    if (block.unlinkedLines.length && rows.some((row) => row.lineIndex === null && row.ackUnlinked !== true)) return { error: "어느 반에도 연결하지 않은 수업 항목이 남습니다. 확인한 뒤 다시 저장해 주세요" };
  }
  const { error } = await db.rpc("save_session_receipt_allocations", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows });
  if (error) return { error: error.message };
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_receipt_allocate", targetType: "invoice", metadata: { invoiceId, basis: "gross_bill", allocations: rows } });
  });
  return { ok: true };
}
