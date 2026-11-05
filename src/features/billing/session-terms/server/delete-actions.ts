"use server";

import { SESSION_BILLING_OFF, sessionBillingOff } from "./module-gate";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { shiftMonth } from "@/lib/date-kst";
import { monthRange } from "../plan";
import { isVirtualTermId } from "../month-roster";
import { logDbError } from "@/lib/supabase/db-error";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANGED = "회차가 변경되었거나 이미 삭제되었습니다. 창을 닫고 다시 열어 확인해 주세요";

type StoredTerm = {
  id: string; invoice_id: string; class_id: string; updated_at: string;
  confirmed_sessions: number | null; unit_price: number | null; amount: number | null;
  planned_sessions: number | null; pricing_mode: string; note: string | null;
  allocation_amount: number | null; allocation_line_index: number | null;
  allocation_carry_out: number; carryover_in: number; carryover_out: number;
  invoice: { period: string; student_id: string } | { period: string; student_id: string }[];
};

export type SessionTermDeletePreview = {
  updatedAt: string;
  confirmedSessions: number | null;
  amount: number | null;
  note: string | null;
  blockedReason: string | null;
};

async function deletionContext(id: string, period: string) {
  const user = await getCurrentUser({ teacherView: true });
  if (!user || !(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" } as const;
  if (await sessionBillingOff()) return { error: SESSION_BILLING_OFF } as const;
  if (typeof id !== "string" || isVirtualTermId(id) || !UUID.test(id)) return { error: "삭제할 회차 행이 없습니다" } as const;
  if (typeof period !== "string" || !monthRange(period)) return { error: "청구월 형식이 올바르지 않습니다" } as const;
  const db = await createClient();
  const { data, error } = await db.from("invoice_session_terms")
    .select("id, invoice_id, class_id, updated_at, confirmed_sessions, unit_price, amount, planned_sessions, pricing_mode, note, allocation_amount, allocation_line_index, allocation_carry_out, carryover_in, carryover_out, invoice:invoice_id!inner ( period, student_id )")
    .eq("tenant_id", user.tenantId).eq("id", id).eq("invoice.period", period).maybeSingle();
  if (error) {
    logDbError(error, "billing.session-terms.deletionContext");
    return { error: "회차 정보를 불러오지 못했습니다. 다시 시도해 주세요" } as const;
  }
  if (!data) return { error: CHANGED } as const;
  const term = data as unknown as StoredTerm;
  const invoice = Array.isArray(term.invoice) ? term.invoice[0] : term.invoice;
  if (!invoice || !term.updated_at) return { error: "회차 정보를 확인할 수 없습니다" } as const;

  let blockedReason: string | null = null;
  // 유효 판정 뒤의 0원이 아니라 저장 원본을 검사한다(환불·무효 배분도 돈의 근거를 보존).
  if (Number(term.allocation_amount ?? 0) !== 0) blockedReason = "수납 배분금이 남아 있습니다. 회차 확정에서 이 학생 줄의 ‘배분’ 버튼으로 이 반의 배분을 정리한 뒤 삭제해 주세요";
  if (Number(term.allocation_carry_out) !== 0 || Number(term.carryover_in) !== 0 || Number(term.carryover_out) !== 0) {
    blockedReason = "금액 또는 시수 이월이 남아 있습니다. 이월을 취소한 뒤 삭제해 주세요";
  }
  if (!blockedReason) {
    // 받는 이월은 지난 달 행에 저장된다. 이월 근거를 못 읽으면 삭제를 허용하지 않는다.
    const incoming = await db.from("invoice_session_terms")
      .select("id, invoice:invoice_id!inner ( period, student_id )")
      .eq("tenant_id", user.tenantId).eq("allocation_carry_class_id", term.class_id)
      .gt("allocation_carry_out", 0).eq("invoice.period", shiftMonth(period, -1))
      .eq("invoice.student_id", invoice.student_id).limit(1);
    if (incoming.error) {
      logDbError(incoming.error, "billing.session-terms.deletionContext");
      return { error: "이월 내역을 확인하지 못했습니다. 다시 시도해 주세요" } as const;
    }
    if (incoming.data?.length) blockedReason = "지난 달에서 받은 금액 이월이 있습니다. 보내는 달에서 이월을 취소한 뒤 삭제해 주세요";
  }
  return { db, user, term, invoice, blockedReason } as const;
}

/** 확인창에는 서버에서 방금 읽은 삭제 대상과 수정 시각을 보낸다. */
export async function getSessionTermDeletePreview(id: string, period: string): Promise<{ preview?: SessionTermDeletePreview; error?: string }> {
  const ctx = await deletionContext(id, period);
  if ("error" in ctx) return { error: ctx.error };
  return { preview: {
    updatedAt: ctx.term.updated_at, confirmedSessions: ctx.term.confirmed_sessions,
    amount: ctx.term.amount, note: ctx.term.note, blockedReason: ctx.blockedReason,
  } };
}

/** 실 행만 삭제한다. 청구서·수납 원본·출석부는 별개이며 명단에 남은 쌍은 '회차 없음'으로 조회된다. */
export async function deleteSessionTerm(id: string, period: string, expectedUpdatedAt: string): Promise<{ ok?: true; error?: string }> {
  const ctx = await deletionContext(id, period);
  if ("error" in ctx) return { error: ctx.error };
  if (typeof expectedUpdatedAt !== "string" || expectedUpdatedAt !== ctx.term.updated_at) return { error: CHANGED };
  if (ctx.blockedReason) return { error: ctx.blockedReason };

  // 읽기-삭제 사이 다른 창의 확정·메모·배분 변경까지 막는다. DELETE RETURNING으로 실제 삭제 여부를 확인한다.
  const { data: deleted, error } = await ctx.db.from("invoice_session_terms").delete()
    .eq("tenant_id", ctx.user.tenantId).eq("id", id).eq("invoice_id", ctx.term.invoice_id)
    .eq("updated_at", expectedUpdatedAt)
    .or("allocation_amount.is.null,allocation_amount.eq.0")
    .eq("allocation_carry_out", 0).eq("carryover_in", 0).eq("carryover_out", 0)
    .select("id").maybeSingle();
  if (error) {
    logDbError(error, "billing.session-terms.deleteSessionTerm");
    return { error: "회차를 삭제하지 못했습니다. 다시 시도해 주세요" };
  }
  if (!deleted) return { error: CHANGED };

  after(async () => {
    await logAction({
      action: "session_term_delete", targetType: "invoice_session_term", targetLabel: `${period} 회차 삭제`,
      metadata: {
        termId: id, invoiceId: ctx.term.invoice_id, classId: ctx.term.class_id, studentId: ctx.invoice.student_id, period,
        plannedSessions: ctx.term.planned_sessions, sessionsBefore: ctx.term.confirmed_sessions,
        unitPriceBefore: ctx.term.unit_price, amountBefore: ctx.term.amount, pricingMode: ctx.term.pricing_mode,
        note: ctx.term.note, allocationAmount: ctx.term.allocation_amount, allocationLineIndex: ctx.term.allocation_line_index,
      },
    });
  });
  revalidatePath("/billing");
  revalidatePath("/attendance");
  revalidatePath("/payroll");
  return { ok: true };
}
