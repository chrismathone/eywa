"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { getTenantSettings } from "@/features/owner/server/queries";
import { resolveDueDate } from "@/features/billing/tuition-calc";

// ⚠️ 수납 수정·일괄완납 액션(updateInvoicePayment·batchMarkInvoicesPaid·deriveStatus)은 2026-07-13
// 라인 단위 표 전환(makeedu 우선 읽기 미러) 때 UI와 함께 **삭제**했다 — 소비처 0인데 "use server"라
// 호출 가능한 엔드포인트로 남고, 특히 옛 deriveStatus는 할인 미차감(paid>=total)이라 새 완납 공식과
// 모순돼 부활 시 848건 오판 사고를 재생산한다. 수동 청구(createInvoice)의 완납 처리 경로는 별도 과제.

const INVOICE_CATEGORIES: Record<string, string> = {
  tuition: "수강료",
  material: "교재",
  exam: "시험",
  other: "기타",
};
const PERIOD_RE = /^\d{4}-\d{2}$/;

function won(v: FormDataEntryValue | null): number {
  return Number(String(v ?? "0").replace(/[,\s]/g, "")) || 0;
}

export type CreateInvoiceState =
  | { error?: string; fieldErrors?: Record<string, string>; ok?: boolean }
  | undefined;

/** 청구서 신규 생성 — 학생·청구월(YYYY-MM)·항목·금액. (tenant,student,period) 유니크 위반은 친절히 안내. */
export async function createInvoice(
  _prev: CreateInvoiceState,
  formData: FormData,
): Promise<CreateInvoiceState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  if (!(await canWriteTenant(user.systemRole, "billing"))) return { error: "수납 관리 권한이 없습니다" };

  const studentId = String(formData.get("studentId") ?? "").trim();
  const period = String(formData.get("period") ?? "").trim();
  const categoryRaw = String(formData.get("category") ?? "tuition").trim();
  const amountTotal = won(formData.get("amountTotal"));
  const amountDiscount = won(formData.get("amountDiscount"));
  let dueDate = String(formData.get("dueDate") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const billedAt = String(formData.get("billedAt") ?? "").trim() || null;
  const discountReason = String(formData.get("discountReason") ?? "").trim() || null;

  const fieldErrors: Record<string, string> = {};
  if (!studentId) fieldErrors.studentId = "학생을 선택해주세요";
  if (!PERIOD_RE.test(period)) fieldErrors.period = "청구월 형식은 YYYY-MM 입니다";
  if (amountTotal <= 0) fieldErrors.amountTotal = "청구액을 입력해주세요";
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  const category = INVOICE_CATEGORIES[categoryRaw] ? categoryRaw : "tuition";

  // 마감일 미입력 시 학원 설정의 기본 납부 마감일(billing.dueDay)로 산출(period의 N일, 말일 clamp).
  if (!dueDate) {
    const { billing } = await getTenantSettings();
    dueDate = resolveDueDate(period, billing.dueDay) || null;
  }

  const supabase = await createClient();
  const lineItems = [{ kind: category, description: INVOICE_CATEGORIES[category], amount: amountTotal }];
  const { error } = await supabase.from("invoices").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    period,
    category,
    amount_total: amountTotal,
    amount_paid: 0,
    amount_discount: amountDiscount,
    status: "unpaid",
    line_items: lineItems,
    due_date: dueDate,
    billed_at: billedAt,
    discount_reason: discountReason,
    notes,
  });
  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      return { error: "이미 해당 학생의 이 달 청구서가 있습니다" };
    }
    return { error: error.message };
  }

  await logAction({
    action: "invoice_create",
    targetType: "invoice",
    targetLabel: `${period} · ${INVOICE_CATEGORIES[category]}`,
    metadata: { studentId, amountTotal },
  });
  revalidatePath("/billing");
  return { ok: true };
}
