import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { WithdrawalReport } from "../model";

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"11월까지 납부했는데, 퇴원보고서상에는 10월납부밖에 없음… 이후에 납부한건 혹은 환불한 건에
 * 대해서도 표시할 수 있어야함"*(김덕현 — 10월 퇴원 · 11월 수업료 710,000원 납부). 무효(void) 청구는 뺀다.
 * 환불 요청서(academy_documents · refund_request)는 설명 칸의 표식으로 이 보고서·청구와 잇는다(같은 청구로 두 번 만들지 않게).
 */
export type LaterInvoice = {
  id: string; period: string; category: string; status: string;
  amountTotal: number; amountDiscount: number; amountPaid: number;
  /** 이 보고서에서 원장이 승인해 만든 환불 요청서(없으면 null). */
  refundDocId: string | null;
};

export const refundTag = (reportId: string, invoiceId: string) => `퇴원보고서 환불 승인 · report:${reportId} · invoice:${invoiceId}`;

/**
 * 🔴 **전체 퇴원만** — 청구는 학생 단위라 과목 하나 수강종료(subject_end)면 계속 듣는 과목의 청구와 가를 수 없다
 *    (리뷰 2026-10-29: 수학만 끝낸 학생의 영어 11월 수업료가 환불 대상으로 뜨던 것).
 * 🔴 **다시 등록하기 전까지만** — 퇴원일 뒤에 시작한 수강이 있으면 그 달부터는 새로 다니는 청구다(옛 보고서가 재등록 뒤 청구를 잡지 않게).
 */
export async function loadLaterInvoices(report: Pick<WithdrawalReport, "id" | "tenant_id" | "student_id" | "effective_date" | "exit_kind">): Promise<LaterInvoice[]> {
  if (report.exit_kind !== "withdrawal") return [];
  const month = report.effective_date.slice(0, 7);
  const admin = createAdminClient();
  const [{ data: rows, error }, { data: docs, error: docError }, { data: again, error: againError }] = await Promise.all([
    admin.from("invoices").select("id,period,category,status,amount_total,amount_discount,amount_paid")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("period", month).neq("status", "void")
      .order("period").limit(60),
    // 청구 기준으로 찾는다 — 같은 학생의 다른 보고서에서 승인했어도 '승인됨'으로 보이게(리뷰).
    admin.from("academy_documents").select("id,description")
      .eq("tenant_id", report.tenant_id).eq("form_type", "refund_request").like("description", "퇴원보고서 환불 승인 ·%").limit(500),
    admin.from("enrollments").select("start_date")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("start_date", report.effective_date).order("start_date").limit(1),
  ]);
  if (error) throw new Error(`퇴원 뒤 청구 조회 실패: ${error.message}`);
  if (docError) throw new Error(`환불 요청서 조회 실패: ${docError.message}`);
  if (againError) throw new Error(`재등록 확인 실패: ${againError.message}`);
  const reenrolled = again?.[0]?.start_date ? String(again[0].start_date).slice(0, 7) : null;
  return (rows ?? []).filter(r => !reenrolled || String(r.period) < reenrolled).map(r => ({
    id: String(r.id), period: String(r.period), category: String(r.category), status: String(r.status),
    amountTotal: Number(r.amount_total), amountDiscount: Number(r.amount_discount), amountPaid: Number(r.amount_paid),
    refundDocId: (docs ?? []).find(d => String(d.description ?? "").includes(`invoice:${r.id}`))?.id ?? null,
  }));
}
