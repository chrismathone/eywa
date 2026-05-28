"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";

type InvoiceStatus = "unpaid" | "partial" | "paid" | "refunded" | "void";

function deriveStatus(amountTotal: number, amountPaid: number, explicit: string): InvoiceStatus {
  // refunded/void are terminal states the user must select explicitly
  if (explicit === "refunded" || explicit === "void") return explicit;
  if (amountPaid <= 0) return "unpaid";
  if (amountPaid >= amountTotal) return "paid";
  return "partial";
}

export type UpdateInvoiceState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

export async function updateInvoicePayment(
  _prev: UpdateInvoiceState,
  formData: FormData,
): Promise<UpdateInvoiceState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "청구서 ID가 누락되었습니다" };

  const amountPaidRaw = String(formData.get("amountPaid") ?? "0").replace(/[,\s]/g, "");
  const amountPaid = Number(amountPaidRaw);
  if (!Number.isFinite(amountPaid) || amountPaid < 0) {
    return { fieldErrors: { amountPaid: "0 이상 숫자만 입력해주세요" } };
  }

  const statusInput = String(formData.get("status") ?? "");
  const category = String(formData.get("category") ?? "").trim() || "tuition";
  const amountDiscountRaw = String(formData.get("amountDiscount") ?? "0").replace(/[,\s]/g, "");
  const amountDiscount = Number(amountDiscountRaw) || 0;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  const supabase = await createClient();
  const { data: cur } = await supabase
    .from("invoices")
    .select("amount_total, paid_at")
    .eq("id", id)
    .single();

  if (!cur) return { error: "청구서를 찾을 수 없습니다" };

  const amountTotal = Number(cur.amount_total);
  if (amountPaid > amountTotal * 1.5) {
    return { fieldErrors: { amountPaid: "청구액의 150%를 초과합니다. 확인해주세요." } };
  }

  const derived = deriveStatus(amountTotal, amountPaid, statusInput);
  // paidAt: paid면 기존 값 유지, 없으면 현재 시각. paid 외 상태로 바뀌면 paidAt null.
  const paidAt =
    derived === "paid" ? cur.paid_at ?? new Date().toISOString() : null;

  const { error } = await supabase
    .from("invoices")
    .update({
      amount_paid: amountPaid,
      amount_discount: amountDiscount,
      status: derived,
      category,
      notes,
      paid_at: paidAt,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/billing");
  return undefined;
}

export type BatchPaidState = { error?: string; saved?: number } | undefined;

export async function batchMarkInvoicesPaid(
  _prev: BatchPaidState,
  formData: FormData,
): Promise<BatchPaidState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const idsRaw = String(formData.get("ids") ?? "").trim();
  const ids = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { error: "선택된 청구서가 없습니다" };

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("invoices")
    .select("id, amount_total")
    .in("id", ids);

  if (!rows || rows.length === 0) return { error: "청구서를 찾을 수 없습니다" };

  const nowIso = new Date().toISOString();
  let saved = 0;
  for (const r of rows) {
    const { error } = await supabase
      .from("invoices")
      .update({
        amount_paid: r.amount_total,
        status: "paid",
        paid_at: nowIso,
      })
      .eq("id", r.id);
    if (error) return { error: error.message };
    saved++;
  }

  revalidatePath("/billing");
  return { saved };
}
