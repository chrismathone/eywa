"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { getSessionTermsView, type SessionTermRow } from "./queries";
import { receiptLines, tuitionTotal, type ReceiptLine } from "../receipt-allocation";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { canUseFreeAllocation, freeShapeSaved, validateFreeAllocation, type FreeAllocationRow } from "../free-allocation";
import { enrollmentPeriodLabel } from "../receipt-merge";
import { monthRange } from "../plan";
import { suggestReceiptAllocations, type ReceiptSuggestion } from "../receipt-suggestion";
import { isTuitionReceipt } from "../tuition-receipt";
import { unlinkedZeroBlockers } from "../unlinked-zero";
import { isVirtualTermId } from "../month-roster";
import { materializeVirtualTerms } from "./term-materialize";
import { logDbError, explainDbError } from "@/lib/supabase/db-error";
import { carryBreaksAfter, carrySyncNotice, loadCarryOutStates, syncCarrySessionsAfter } from "./carry-session-sync";

/**
 * `terms`엔 회차 행이 없는 줄(가상 id, `termState: "missing"`)도 선다 — 이 학생의 그 달 출석부 줄인데 행이 없는 반(보강 방문 등).
 * 배분을 저장하는 순간 서버가 행을 만들고 실 id로 저장한다(`saveReceiptAllocation`).
 */
export type ReceiptAllocationView = {
  period?: string; lines: ReceiptLine[]; source: unknown; suggestions?: ReceiptSuggestion[]; terms: (SessionTermRow & { enrollmentLabel?: string })[];
  /** 자유 배분을 쓸 수 있나 — 관리자 이상 + super_admin(원장 2026-09-21). 서버 저장도 같은 판정을 다시 본다(#77). */
  canFree?: boolean;
  /**
   * 이 청구서가 지금 자유 배분으로 저장돼 있다 — 연결 행이 하나도 없고 **금액이 있는** 연결 없는 행이 있다(`freeShapeSaved`).
   * 항목별 창의 '연결 안 함 0원'만 있는 청구서는 자유 배분이 아니다.
   */
  freeSaved?: boolean;
  /** 수업 청구액 합계 — 자유 배분의 상한(받은 돈보다 더 줄 수 없다). */
  tuitionTotal?: number;
};
/**
 * `lineIndex: null` = 연결할 수납 항목이 없는 확정 반을 0원으로 저장(0269a — 금액은 0만).
 * `ackUnlinked` = 어느 반에도 안 붙은 수업 항목이 남는다는 확인을 받았다(그런 항목이 있으면 0원 행에 필수).
 */
export type ReceiptAllocationInput = { termId: string; lineIndex: number | null; amount: number; baseAmount: number | null; confirmedAt: string | null; ackUnlinked?: boolean };

// 🔑 행위자 = `getCurrentUser({ teacherView: true })` — '다른 강사 뷰'면 대상 직원 X(원장 2026-11-05 강사뷰 전수).
//    자유 배분의 '관리자 이상' 판정(canUseFreeAllocation)은 **역할**을 보므로 실제 계정 A의 역할로 보면 X(예: 회계)의 화면에서
//    A(원장)의 권한이 열린다. 확정 기록(confirmed_by — 이월 시수 동기화)도 X 명의. 감사로그 행위자는 logAction이 실제 계정으로 남긴다.
export async function getReceiptAllocation(invoiceId: string): Promise<{ data?: ReceiptAllocationView; error?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const db = await createClient();
  const { data: invoice, error } = await db.from("invoices").select("period, student_id, line_items").eq("id", invoiceId).neq("status", "void").maybeSingle();
  if (error) return { error: explainDbError(error, { scope: "billing.session-terms.receipt-allocation-actions.getReceiptAllocation", fallback: "청구서를 불러오지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (!invoice) return { error: "청구서를 찾을 수 없습니다" };
  const range = monthRange(invoice.period);
  if (!range) return { error: "청구월을 확인해 주세요" };
  const view = await getSessionTermsView(invoice.period, invoiceId);
  const enrollments = (view.enrollmentHistory ?? []).filter((e) => e.student_id === invoice.student_id);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  const lines = receiptLines(invoice.line_items).filter((line) => isTuitionReceipt(line.source));
  const canFree = canUseFreeAllocation(user.systemRole) || (await isCurrentUserSuperAdmin());
  const freeSaved = freeShapeSaved(view.rows);
  return { data: { period: invoice.period, lines, source: invoice.line_items, suggestions: suggestReceiptAllocations(invoice.period, lines, view.rows, enrollments.filter((e) => !e.on_hold)),
    terms: view.rows.map((term) => ({ ...term, enrollmentLabel: enrollmentPeriodLabel(invoice.period, enrollments.filter((e) => e.class_id === term.classId), today) })),
    canFree, freeSaved, tuitionTotal: tuitionTotal(lines) } };
}

/**
 * 관리자가 자유 배분으로 저장한 청구서를 **관리자가 아닌 사람이** 항목별 저장·합산으로 덮지 못하게(원장: *"관리자 이상급이 자유롭게"*).
 * 모양은 DB에서 직접 본다(창을 연 뒤 바뀌었을 수 있다). 조회가 실패하면 막는다 — 모르고 덮는 것보다 다시 시도가 낫다.
 * ⚠️ 모양만 본다 — 자유 배분이 무효가 돼도(다른 반을 새로 확정 등) 잠긴 채라, 관리자가 다시 저장할 때까지 그 달 분배 저장이 막힌다.
 *    분배 저장·시수 검증 문구가 그 사실을 '관리자만 고칠 수 있다'로 가른다(`freeAllocationSaved`).
 */
async function freeAllocationLock(db: Awaited<ReturnType<typeof createClient>>, invoiceId: string, role: Parameters<typeof canUseFreeAllocation>[0]): Promise<string | null> {
  if (canUseFreeAllocation(role) || (await isCurrentUserSuperAdmin())) return null;
  const { data, error } = await db.from("invoice_session_terms").select("id, allocation_line_index, allocation_amount").eq("invoice_id", invoiceId);
  if (error) return "배분 상태를 확인하지 못했습니다. 다시 시도해 주세요";
  const rows = (data ?? []).map((t) => ({ allocationLineIndex: t.allocation_line_index, savedAllocationAmount: t.allocation_amount == null ? null : Number(t.allocation_amount) }));
  return freeShapeSaved(rows) ? "관리자가 자유 배분으로 저장한 청구서입니다 — 관리자만 바꿀 수 있습니다" : null;
}

export async function mergeReceiptItems(invoiceId: string, source: unknown, indices: number[], label: string, removeId?: string): Promise<{ data?: ReceiptAllocationView; error?: string; committed?: boolean }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  const lockDb = await createClient();
  const locked = await freeAllocationLock(lockDb, invoiceId, user.systemRole);
  if (locked) return { error: locked };
  if (!Array.isArray(indices) || indices.length > 50 || indices.some((i) => !Number.isSafeInteger(i) || i < 0)
    || typeof label !== "string" || label.length > 200 || (!removeId && (indices.length < 2 || !label.trim()))) return { error: "합산할 항목과 수납명을 확인해 주세요" };
  const db = await createClient();
  const { error } = await db.rpc("edit_receipt_merge_group", { p_invoice_id: invoiceId, p_expected_lines: source, p_indices: indices, p_label: label, p_remove_id: removeId ?? null });
  if (error) return { error: explainDbError(error, { scope: "billing.session-terms.receipt-allocation-actions.mergeReceiptItems", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  revalidatePath("/billing");
  try {
    const result = await getReceiptAllocation(invoiceId);
    if (result.data) return { data: result.data, committed: true };
  } catch { /* 저장은 완료됐지만 조회가 실패하면 오래된 화면에서 추가 저장하지 않는다. */ }
  return { committed: true, error: "수납 합산 변경은 저장됐습니다. 창을 다시 열어 확인해 주세요." };
}

export async function saveReceiptAllocation(invoiceId: string, source: unknown, input: ReceiptAllocationInput[]): Promise<{ ok?: boolean; error?: string; notice?: string; warning?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!Array.isArray(input) || input.length > 500 || input.some((row) => !Number.isSafeInteger(row.amount) || row.amount < 0 || (row.lineIndex === null ? row.amount !== 0 : !Number.isInteger(row.lineIndex) || row.lineIndex < 0))) return { error: "배분금액과 연결 항목을 확인해 주세요" };
  const eligible = new Set(receiptLines(source).filter((line) => isTuitionReceipt(line.source)).map((line) => line.index));
  if (input.some((row) => row.lineIndex !== null && !eligible.has(row.lineIndex))) return { error: "수업 청구액에만 배분할 수 있습니다" };
  const db = await createClient();
  const locked = await freeAllocationLock(db, invoiceId, user.systemRole);
  if (locked) return { error: locked };
  // 회차 행이 없는 줄(가상 id) — 이 청구서의 학생·그 달 출석부 줄인지 서버가 다시 본 뒤(#77) 행을 만들고 실 id로 바꿔 저장한다.
  // 한 줄이라도 못 만들면 아무것도 저장하지 않는다(배분 합계가 청구액과 맞아야 해서 일부만 저장할 수 없다).
  let rows = input;
  const virtualIds = input.map((row) => row.termId).filter(isVirtualTermId);
  if (virtualIds.length > 0) {
    const { data: invoice, error: invoiceError } = await db.from("invoices").select("period, status").eq("id", invoiceId).maybeSingle();
    if (invoiceError || !invoice) {
      logDbError(invoiceError, "billing.session-terms.saveReceiptAllocation");
      return { error: "청구서를 찾을 수 없습니다" };
    }
    if (invoice.status === "void") return { error: "취소된 청구서에는 배분할 수 없습니다" };
    if (!monthRange(invoice.period)) return { error: "청구월을 확인해 주세요" };
    const made = await materializeVirtualTerms(db, { tenantId: user.tenantId, period: invoice.period, reason: "allocate", invoiceId }, virtualIds);
    if (made.error) return { error: made.error };
    if (made.failed.size > 0) return { error: `${made.failed.size}개 반의 회차 행을 만들지 못했습니다 — ${[...made.failed.values()][0]}` };
    rows = input.map((row) => ({ ...row, termId: made.ids.get(row.termId) ?? row.termId }));
  }
  if (rows.some((row) => row.lineIndex === null)) {
    if (!rows.some((row) => row.lineIndex !== null)) return { error: "수납 항목에 한 반 이상 연결한 뒤 남은 반을 0원으로 저장할 수 있습니다" };
    // '연결 안 함 = 0원'은 빠뜨린 연결을 덮지 못한다 — 화면과 같은 함수로 다시 본다(#77). 확정 여부는 DB 함수가 다시 본다.
    const { data: termRows, error: termError } = await db
      .from("invoice_session_terms")
      .select("id, class_id, confirmed_sessions, class:class_id ( class_name )")
      .eq("invoice_id", invoiceId);
    if (termError || !termRows) {
      logDbError(termError, "billing.session-terms.saveReceiptAllocation");
      return { error: "반 정보를 읽지 못했습니다. 다시 시도해 주세요" };
    }
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
  // 보낸 이월이 있는 줄의 저장 전 상태 — 이번 배분이 그 이월을 무효로 만들면 알린다(2026-11-09).
  const carryBefore = await loadCarryOutStates(db, rows.map((row) => row.termId));
  const { error } = await db.rpc("save_session_receipt_allocations", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows });
  if (error) return { error: explainDbError(error, { scope: "billing.session-terms.receipt-allocation-actions.saveReceiptAllocation", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  // 이 저장으로 지난 달 이월이 이 달 줄에 실렸으면 확정 시수를 그만큼 맞춘다(원장 2026-10-07) — 응답 전에 끝내야 화면이 다시 읽을 때 맞는다.
  const notice = carrySyncNotice(await syncCarrySessionsAfter(db, { invoiceId }, user.id, "allocate"));
  const warning = [...(await carryBreaksAfter(db, carryBefore)).values()].join("\n") || undefined;
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_receipt_allocate", targetType: "invoice", metadata: { invoiceId, basis: "gross_bill", allocations: rows } });
  });
  return { ok: true, ...(notice ? { notice } : {}), ...(warning ? { warning } : {}) };
}

/** 자유 배분 저장 행 — `confirmedAt`·`baseAmount`는 창을 열 때 본 값(그 사이 확정이 바뀌면 DB 함수가 거절한다). */
export type FreeAllocationInput = FreeAllocationRow & { confirmedAt: string | null; baseAmount: number | null };

/**
 * **자유 배분** 저장(0279a) — 원장 2026-09-21 *"총 금액(청구액)은 변하지 않는선에서 출결행에 다 분배"* · *"관리자 이상급이 자유롭게"* ·
 * *"받은 돈보다 더 지급할 순 없다 · 덜 지급하는건 괜찮다"*. 수납 항목에 연결하지 않고 반마다 금액만 — 합계 ≤ 수업 청구액.
 * 🔴 관리자 이상(+ super_admin)만 · 화면과 같은 판정(`validateFreeAllocation`)을 서버가 다시 본다(#77) · DB 함수도 다시 본다.
 */
export async function saveFreeReceiptAllocation(invoiceId: string, source: unknown, input: FreeAllocationInput[]): Promise<{ ok?: boolean; error?: string; warning?: string }> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF };
  if (!canUseFreeAllocation(user.systemRole) && !(await isCurrentUserSuperAdmin())) return { error: "자유 배분은 관리자 이상만 할 수 있습니다" };
  if (!Array.isArray(input) || input.length === 0 || input.length > 500) return { error: "배분할 반을 확인해 주세요" };
  const view = await getReceiptAllocation(invoiceId);
  if (!view.data) return { error: view.error ?? "청구서를 찾을 수 없습니다" };
  if (JSON.stringify(view.data.source) !== JSON.stringify(source)) return { error: "수납 내역이 변경되었습니다. 다시 열어 확인해 주세요" };
  const terms = view.data.terms.map((t) => ({ id: t.id, className: t.className, confirmedSessions: t.confirmedSessions, pricingMode: t.pricingMode, fullyRefunded: t.refundState === "full" }));
  const checked = validateFreeAllocation(terms, input.map((row) => ({ termId: row.termId, amount: Number(row.amount) })), view.data.tuitionTotal ?? 0);
  if (!checked.ok) return { error: checked.error };
  const db = await createClient();
  // 회차 행이 없는 줄(가상 id) — 항목별 저장과 같은 규칙으로 행을 만들고 실 id로 바꿔 저장한다(한 줄이라도 못 만들면 아무것도 안 한다).
  // 감사로그용 반 이름 — 가상 id가 실 id로 바뀌기 전에 적어 둔다.
  const nameOf = new Map(view.data.terms.map((t) => [t.id, t.className]));
  let rows = input.map((row) => ({ termId: row.termId, amount: Number(row.amount), confirmedAt: row.confirmedAt, baseAmount: row.baseAmount, className: nameOf.get(row.termId) ?? null }));
  const virtualIds = rows.map((row) => row.termId).filter(isVirtualTermId);
  if (virtualIds.length > 0) {
    const made = await materializeVirtualTerms(db, { tenantId: user.tenantId, period: view.data.period!, reason: "allocate", invoiceId }, virtualIds);
    if (made.error) return { error: made.error };
    if (made.failed.size > 0) return { error: `${made.failed.size}개 반의 회차 행을 만들지 못했습니다 — ${[...made.failed.values()][0]}` };
    rows = rows.map((row) => ({ ...row, termId: made.ids.get(row.termId) ?? row.termId }));
  }
  // 보낸 이월이 있는 줄의 저장 전 상태 — 이번 자유 배분이 그 이월을 무효로 만들면 알린다(2026-11-09).
  const carryBefore = await loadCarryOutStates(db, rows.map((row) => row.termId));
  const { error } = await db.rpc("save_session_receipt_allocations_free", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return { error: "자유 배분 기능이 아직 켜지지 않았습니다. 관리자에게 알려 주세요(SQL 적용 필요)" };
    if (error.code === "P0001" && /[가-힣]/.test(error.message)) return { error: error.message };
    console.error("[free-allocation] 자유 배분 저장 실패", error.code, error.message);
    return { error: "배분을 저장하지 못했습니다. 다시 시도해 주세요" };
  }
  after(async () => {
    revalidatePath("/billing");
    await logAction({ action: "session_term_receipt_allocate_free", targetType: "invoice", metadata: {
      invoiceId, period: view.data!.period, basis: "gross_bill", tuitionTotal: view.data!.tuitionTotal, allocatedTotal: checked.sum,
      allocations: rows.map((row) => ({ termId: row.termId, amount: row.amount, className: row.className })),
    } });
  });
  const warning = [...(await carryBreaksAfter(db, carryBefore)).values()].join("\n") || undefined;
  return { ok: true, ...(warning ? { warning } : {}) };
}
