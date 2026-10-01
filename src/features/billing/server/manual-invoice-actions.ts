"use server";

// 수동 청구서 취소·완납(감사 N15, 2026-09-23) — 잘못 만든 수동 청구서가 영구 미수로 남아 미수 총액·수납률을 왜곡했다.
//
// 🔴 **aywa에서 직접 만든 청구서(createInvoice)에만** 연다. makeedu 동기화 청구서는 makeedu가 진실이라 여기서 바꾸면
//    다음 동기화가 덮어쓴다(그 전까지는 두 시스템이 다른 말을 한다). 판정은 `isManualInvoiceShape` 한 벌(동기화 스크립트
//    invoice-stale.cjs `isMakeeduShape`의 반대 — 같은 규칙) + **저장된 원본 line_items**로 서버가 다시 본다(#77).
// 🔴 되살린 옛 수정 액션(updateInvoicePayment·deriveStatus)이 아니다 — 금액을 사람이 적지 않는다.
//    완납 = 실청구(청구 − 할인)를 그대로 수납액으로 · 취소 = status 'void'(미수 집계에서 빠진다, calc.ts).
// 🔴 동시성 — 읽은 `updated_at`이 그대로일 때만 쓴다(그 사이 동기화가 같은 (학생,월)을 makeedu 청구로 덮었으면 거절).
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError, logDbError } from "@/lib/supabase/db-error";
import { logAction } from "@/features/audit/server/log";
import { isManualInvoiceShape, PAYMENT_METHOD_LABEL } from "../invoice-lines";

export type ManualInvoiceActionResult = { ok?: true; error?: string };

const UUID = /^[0-9a-f-]{36}$/i;

async function loadManualInvoice(invoiceId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" } as const;
  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" } as const;
  if (typeof invoiceId !== "string" || !UUID.test(invoiceId)) return { error: "청구서를 찾을 수 없습니다" } as const;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select("id, student_id, period, status, amount_total, amount_discount, amount_paid, line_items, notes, updated_at")
    .eq("tenant_id", user.tenantId)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "조회") } as const;
  if (!data) return { error: "청구서를 찾을 수 없습니다" } as const;
  if (!isManualInvoiceShape(data.line_items)) {
    return { error: "메이크에듀에서 동기화된 청구서는 여기서 바꿀 수 없습니다 — 메이크에듀에서 고치면 다음 동기화에 반영됩니다" } as const;
  }
  return { user, supabase, inv: data } as const;
}

/** 수동 청구서 **취소**(void) — 미납(unpaid)일 때만. 회차 확정·수납 배분이 걸린 청구서는 먼저 정리해야 한다. */
export async function voidManualInvoice(invoiceId: string): Promise<ManualInvoiceActionResult> {
  const ctx = await loadManualInvoice(invoiceId);
  if ("error" in ctx) return { error: ctx.error };
  const { user, supabase, inv } = ctx;
  if (inv.status !== "unpaid") {
    return { error: inv.status === "void" ? "이미 취소된 청구서입니다" : "수납 기록이 있는 청구서는 취소할 수 없습니다" };
  }
  // 회차 확정·배분이 이 청구서에 걸려 있으면 취소하지 않는다(취소된 청구서의 확정·배분은 급여 분배의 근거를 잃는다).
  const { count, error: termErr } = await supabase
    .from("invoice_session_terms")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("invoice_id", inv.id)
    .or("confirmed_sessions.not.is.null,allocation_amount.not.is.null");
  if (termErr) {
    logDbError(termErr, "billing.voidManualInvoice");
    return { error: "회차 확정 연결을 확인하지 못했습니다. 다시 시도해 주세요" };
  }
  if ((count ?? 0) > 0) return { error: "회차 확정·수납 배분이 걸린 청구서입니다 — 회차 확정 면에서 먼저 해제한 뒤 취소해 주세요" };

  const { data: updated, error } = await supabase
    .from("invoices")
    .update({ status: "void" })
    .eq("tenant_id", user.tenantId)
    .eq("id", inv.id)
    .eq("status", "unpaid")
    .eq("updated_at", inv.updated_at)
    .select("id")
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message) };
  if (!updated) return { error: "그 사이 청구서가 바뀌었습니다 — 새로고침한 뒤 다시 시도해 주세요" };

  await logAction({
    action: "invoice_manual_void",
    targetType: "invoice",
    targetLabel: inv.period,
    metadata: {
      invoiceId: inv.id,
      studentId: inv.student_id,
      period: inv.period,
      statusFrom: inv.status,
      amountTotal: Number(inv.amount_total),
      amountDiscount: Number(inv.amount_discount),
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}

/**
 * 수동 청구서 **완납 처리** — 미납·부분(unpaid/partial)일 때. 수납액 = 실청구(청구 − 할인), 수납일 = 지금.
 * 결제수단은 선택(card·transfer·cash·other) — 모르면 비워 둔다(지어내지 않는다).
 */
export async function markManualInvoicePaid(invoiceId: string, method?: string | null): Promise<ManualInvoiceActionResult> {
  const ctx = await loadManualInvoice(invoiceId);
  if ("error" in ctx) return { error: ctx.error };
  const { user, supabase, inv } = ctx;
  if (inv.status !== "unpaid" && inv.status !== "partial") {
    return { error: inv.status === "paid" ? "이미 완납된 청구서입니다" : "이 상태의 청구서는 완납 처리할 수 없습니다" };
  }
  const paymentMethod = method && method in PAYMENT_METHOD_LABEL ? method : null;
  const net = Math.max(0, Number(inv.amount_total) - Number(inv.amount_discount));
  const patch: Record<string, unknown> = { status: "paid", amount_paid: net, paid_at: new Date().toISOString() };
  if (paymentMethod) patch.payment_method = paymentMethod;

  const { data: updated, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("tenant_id", user.tenantId)
    .eq("id", inv.id)
    .eq("status", inv.status)
    .eq("updated_at", inv.updated_at)
    .select("id")
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message) };
  if (!updated) return { error: "그 사이 청구서가 바뀌었습니다 — 새로고침한 뒤 다시 시도해 주세요" };

  await logAction({
    action: "invoice_manual_paid",
    targetType: "invoice",
    targetLabel: inv.period,
    metadata: {
      invoiceId: inv.id,
      studentId: inv.student_id,
      period: inv.period,
      statusFrom: inv.status,
      paidFrom: Number(inv.amount_paid),
      paidTo: net,
      method: paymentMethod,
    },
  });
  revalidatePath("/billing");
  return { ok: true };
}
