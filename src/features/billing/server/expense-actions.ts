"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { normalizeApprovalChecks } from "./expense-queries";

// 지출(expenses) CRUD — invoices의 updateInvoicePayment 골격을 그대로 본뜸
// (getCurrentUser 가드 → FormData 파싱·검증 → supabase(RLS) → revalidatePath). tenant_id는
// RLS가 강제하지만 INSERT엔 명시 필요.
export type ExpenseState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean }
  | undefined;

const VALID_CATEGORIES = new Set(["인건비", "운영비", "매입", "마케팅", "기타"]);

function won(v: FormDataEntryValue | null): number {
  return Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0;
}

const VALID_ROLES = new Set(["author", "director", "ceo", "executor"]);
const today = () => new Date().toISOString().slice(0, 10);

function parse(formData: FormData) {
  const categoryRaw = String(formData.get("category") ?? "기타").trim();
  let lineItems: Array<Record<string, unknown>> | null = null;
  const liRaw = String(formData.get("lineItems") ?? "").trim();
  if (liRaw) {
    try {
      const v = JSON.parse(liRaw);
      lineItems = Array.isArray(v) && v.length > 0 ? v : null;
    } catch {
      lineItems = null;
    }
  }
  // 거래처(vendor)는 라인아이템별로 입력 → 목록/폴백용 top-level vendor는 첫 라인 거래처에서 유도.
  const firstVendor = lineItems?.find((l) => typeof l.vendor === "string" && l.vendor.trim())?.vendor;
  const formVendor = String(formData.get("vendor") ?? "").trim();
  return {
    title: String(formData.get("title") ?? "").trim(),
    category: VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : "기타",
    amount: won(formData.get("amount")),
    expenseDate: String(formData.get("expenseDate") ?? "").trim(),
    vendor: (typeof firstVendor === "string" ? firstVendor : formVendor) || null,
    department: String(formData.get("department") ?? "").trim() || null,
    author: String(formData.get("author") ?? "").trim() || null,
    position: String(formData.get("position") ?? "").trim() || null,
    paymentMethod: String(formData.get("paymentMethod") ?? "").trim() || null,
    bankName: String(formData.get("bankName") ?? "").trim() || null,
    accountNumber: String(formData.get("accountNumber") ?? "").trim() || null,
    memo: String(formData.get("memo") ?? "").trim() || null,
    lineItems,
  };
}

function validate(f: ReturnType<typeof parse>): ExpenseState {
  if (!f.title) return { fieldErrors: { title: "항목명을 입력해주세요" } };
  if (!f.expenseDate) return { fieldErrors: { expenseDate: "지출일을 입력해주세요" } };
  if (!Number.isFinite(f.amount) || f.amount < 0) {
    return { fieldErrors: { amount: "0 이상 숫자만 입력해주세요" } };
  }
  return undefined;
}

export async function createExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").insert({
    tenant_id: user.tenantId,
    title: f.title,
    category: f.category,
    amount: f.amount,
    expense_date: f.expenseDate,
    vendor: f.vendor,
    department: f.department,
    author: f.author ?? user.displayName,
    position: f.position,
    payment_method: f.paymentMethod,
    bank_name: f.bankName,
    account_number: f.accountNumber,
    memo: f.memo,
    line_items: f.lineItems,
    // 작성 단계는 저장 즉시 체크(ijw 패리티). 원장/대표/집행자는 목록에서 토글.
    approval_checks: { author: { checked: true, date: today() } },
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function updateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const f = parse(formData);
  const invalid = validate(f);
  if (invalid) return invalid;

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .update({
      title: f.title,
      // 작성자를 비우고 저장해도 기존 값 보존(실수로 null 덮어쓰기 방지). 비어있지 않을 때만 갱신.
      ...(f.author ? { author: f.author } : {}),
      category: f.category,
      amount: f.amount,
      expense_date: f.expenseDate,
      vendor: f.vendor,
      department: f.department,
      position: f.position,
      payment_method: f.paymentMethod,
      bank_name: f.bankName,
      account_number: f.accountNumber,
      memo: f.memo,
      line_items: f.lineItems,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

export async function deleteExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("expenses").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// 결재 단계 토글(작성/원장/대표/집행자) — ijw approvalChecks 패리티. 기존 jsonb를 읽어 merge 후 갱신하고,
// approval_status는 (원장 && 대표) 결재 시 approved로 파생(문서 결재완료 배지·요약 일관). 권한은 페이지의
// requireAccess("billing")가 이미 게이트(eywa엔 expenseRole 개념 없음 → billing 쓰기 가능자면 토글 가능).
export async function toggleExpenseApproval(
  _prev: ExpenseState,
  formData: FormData,
): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const role = String(formData.get("role") ?? "").trim();
  if (!VALID_ROLES.has(role)) return { error: "잘못된 결재 역할입니다" };
  const checked = String(formData.get("checked") ?? "") === "true";

  const supabase = await createClient();
  const { data: row, error: readErr } = await supabase
    .from("expenses")
    .select("approval_checks")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!row) return { error: "지출을 찾을 수 없습니다" };

  // 기존 결재 상태를 정규화(문자열 이중 인코딩 파싱 + 유효 역할만)해 merge — 잡키·문자열 오염 방지.
  const base = normalizeApprovalChecks(row.approval_checks);
  base[role as keyof typeof base] = checked ? { checked: true, date: today() } : { checked: false };
  const approvalStatus = base.director?.checked && base.ceo?.checked ? "approved" : "pending";

  const { error } = await supabase
    .from("expenses")
    .update({ approval_checks: base, approval_status: approvalStatus, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}

// 복제(duplicate) — 기존 결의서를 새 결의서로. 날짜=오늘, 작성자=현재 사용자, 결재 체크는 작성만(원장/대표/집행자
// 초기화), 제목·항목·메모·정산정보는 그대로. ijw "매월 반복 결의서 빠른 입력" 패리티.
export async function duplicateExpense(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: src, error: readErr } = await supabase
    .from("expenses")
    .select(
      "title, category, amount, vendor, department, payment_method, bank_name, account_number, memo, line_items",
    )
    .eq("id", id)
    .maybeSingle();
  if (readErr) return { error: readErr.message };
  if (!src) return { error: "원본 지출을 찾을 수 없습니다" };

  const { error } = await supabase.from("expenses").insert({
    tenant_id: user.tenantId,
    title: src.title,
    category: src.category,
    amount: src.amount,
    expense_date: today(),
    vendor: src.vendor,
    department: src.department,
    author: user.displayName,
    position: null,
    payment_method: src.payment_method,
    bank_name: src.bank_name,
    account_number: src.account_number,
    memo: src.memo,
    line_items: src.line_items,
    approval_status: "pending",
    approval_checks: { author: { checked: true, date: today() } },
  });
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}
