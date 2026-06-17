"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

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

function parse(formData: FormData) {
  const categoryRaw = String(formData.get("category") ?? "기타").trim();
  let lineItems: unknown = null;
  const liRaw = String(formData.get("lineItems") ?? "").trim();
  if (liRaw) {
    try {
      const v = JSON.parse(liRaw);
      lineItems = Array.isArray(v) && v.length > 0 ? v : null;
    } catch {
      lineItems = null;
    }
  }
  return {
    title: String(formData.get("title") ?? "").trim(),
    category: VALID_CATEGORIES.has(categoryRaw) ? categoryRaw : "기타",
    amount: won(formData.get("amount")),
    expenseDate: String(formData.get("expenseDate") ?? "").trim(),
    vendor: String(formData.get("vendor") ?? "").trim() || null,
    department: String(formData.get("department") ?? "").trim() || null,
    paymentMethod: String(formData.get("paymentMethod") ?? "").trim() || null,
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
    payment_method: f.paymentMethod,
    memo: f.memo,
    line_items: f.lineItems,
    author: user.displayName,
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
      category: f.category,
      amount: f.amount,
      expense_date: f.expenseDate,
      vendor: f.vendor,
      department: f.department,
      payment_method: f.paymentMethod,
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

// 승인 상태 토글(pending↔approved). 단순 2단계(ijw의 4역할 결재는 범위 밖).
export async function setExpenseApproval(_prev: ExpenseState, formData: FormData): Promise<ExpenseState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "지출 ID가 누락되었습니다" };
  const next = String(formData.get("approvalStatus") ?? "").trim();
  if (next !== "pending" && next !== "approved") return { error: "잘못된 승인 상태입니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("expenses")
    .update({ approval_status: next, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/billing");
  return { ok: true };
}
