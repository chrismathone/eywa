import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { billingPrefill } from "../prefill";
import type { WithdrawalReport } from "../model";

/** 검증된 보고서 학생의 수납 요약만 제공한다. 저장·제출 시에도 장부에서 다시 계산한다. */
export async function loadReportBilling(report: WithdrawalReport) {
  const month = report.effective_date.slice(0, 7);
  const rows = await fetchAllPaged<{ period: string; category: string; status: string; amount_total: number; amount_paid: number; amount_discount: number }>((from, to) => createAdminClient().from("invoices")
    .select("period,category,status,amount_total,amount_paid,amount_discount")
    .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).lte("period", month)
    .order("id").range(from, to));
  return billingPrefill(rows.map(r => ({ period: r.period, category: r.category, status: r.status, amountTotal: Number(r.amount_total), amountPaid: Number(r.amount_paid), amountDiscount: Number(r.amount_discount) })), month, kstToday());
}
