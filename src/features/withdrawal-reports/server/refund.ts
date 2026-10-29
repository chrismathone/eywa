import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { toPrefillLines } from "@/features/billing/server/refund-queries";
import type { RefundPrefillLine } from "@/features/billing/refund-prefill";
import type { WithdrawalReport } from "../model";

/**
 * 퇴원월 **뒤** 청구 — 원장 2026-10-29 *"11월까지 납부했는데, 퇴원보고서상에는 10월납부밖에 없음… 이후에 납부한건 혹은 환불한 건에
 * 대해서도 표시할 수 있어야함"*(김덕현 — 영어만 수강종료 10-28 · 11월 청구에 영어 반 줄 315,000원 납부). 무효(void) 청구는 뺀다.
 * 환불 요청서(academy_documents · refund_request)는 설명 칸의 표식으로 청구와 잇는다(같은 청구로 두 번 만들지 않게).
 */
export type LaterInvoice = {
  id: string; period: string; category: string; status: string;
  /** 이 보고서가 끝내는 수업 몫(전체 퇴원 = 청구 전체 · 과목 수강종료 = 끝내는 반 이름 줄만). */
  amountBilled: number; amountPaid: number;
  /** 과목 수강종료일 때 고른 줄(반 이름) — 표·요청서 결제내역에 그대로 쓴다. */
  lines: RefundPrefillLine[];
  partial: boolean;
  refund: { documentId: string; deskName: string | null; completed: boolean } | null;
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export const refundTag =(reportId: string, invoiceId: string) => `퇴원보고서 환불 승인 · report:${reportId} · invoice:${invoiceId}`;

/**
 * - 전체 퇴원: 퇴원월 뒤 청구 전체.
 * - 과목 수강종료: 청구는 학생 단위라, **끝내는 반 이름과 같은 줄**(makeedu 청구 줄 `description` = 반 이름)만 고른다.
 *   그런 줄이 없는 청구는 보이지 않는다(계속 듣는 과목 청구를 환불 대상으로 잡지 않게 · 리뷰 2026-10-29).
 * - 다시 등록하기 전까지만 — 퇴원일 뒤에 시작한 수강이 있으면 그 달부터는 새로 다니는 청구다.
 */
export async function loadLaterInvoices(report: Pick<WithdrawalReport, "id" | "tenant_id" | "student_id" | "effective_date" | "exit_kind" | "subjects" | "snapshot">): Promise<LaterInvoice[]> {
  const month = report.effective_date.slice(0, 7);
  const admin = createAdminClient();
  const ended = report.exit_kind === "withdrawal" ? null
    : new Set(report.snapshot.courses.filter(c => report.subjects.includes(c.subject)).map(c => norm(c.className)));
  const [{ data: rows, error }, { data: docs, error: docError }, { data: again, error: againError }] = await Promise.all([
    admin.from("invoices").select("id,period,category,status,amount_total,amount_discount,amount_paid,line_items")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("period", month).neq("status", "void")
      .order("period").limit(60),
    admin.from("academy_documents").select("id,description,form_data")
      .eq("tenant_id", report.tenant_id).eq("form_type", "refund_request").like("description", "퇴원보고서 환불 승인 ·%").limit(500),
    // 과목 수강종료는 다른 과목을 계속 다니니 '재등록'을 같은 과목에서만 본다.
    admin.from("enrollments").select("start_date, classes!inner(subject)")
      .eq("tenant_id", report.tenant_id).eq("student_id", report.student_id).gt("start_date", report.effective_date).order("start_date").limit(20),
  ]);
  if (error) throw new Error(`퇴원 뒤 청구 조회 실패: ${error.message}`);
  if (docError) throw new Error(`환불 요청서 조회 실패: ${docError.message}`);
  if (againError) throw new Error(`재등록 확인 실패: ${againError.message}`);
  const restart = (again ?? []).find(e => {
    const subject = (e.classes as unknown as { subject: string } | null)?.subject;
    return report.exit_kind === "withdrawal" || (subject != null && report.subjects.includes(subject));
  });
  const reenrolled = restart?.start_date ? String(restart.start_date).slice(0, 7) : null;
  const out: LaterInvoice[] = [];
  for (const r of rows ?? []) {
    if (reenrolled && String(r.period) >= reenrolled) continue;
    // 요청서는 보고서·청구 짝으로 찾는다 — 한 청구로 두 과목을 차례로 끝내도 과목마다 따로(리뷰 2026-10-29).
    const forInvoice = (docs ?? []).filter(d => String(d.description ?? "").includes(`invoice:${r.id}`));
    const doc = forInvoice.find(d => String(d.description ?? "").includes(`report:${report.id}`));
    // 다른 보고서가 이미 환불 승인한 반 줄은 빼서 같은 돈을 두 번 돌려주지 않게.
    const taken = new Set(forInvoice.filter(d => d !== doc).flatMap(d =>
      String((d.form_data as { student?: { className?: string } } | null)?.student?.className ?? "").split(",").map(norm).filter(Boolean)));
    const all = toPrefillLines(r.line_items);
    const lines = all.filter(l => (!ended || ended.has(norm(l.description))) && !taken.has(norm(l.description)));
    const partial = !!ended || taken.size > 0;
    if (partial && !lines.length) continue;
    // 줄별 납부액이 없는 옛 청구는 완납 청구면 줄 청구액(금액 − 할인)을 낸 것으로 본다.
    const linePaid = (l: RefundPrefillLine) => l.paid ?? (r.status === "paid" ? Math.max(0, l.amount - (l.discount ?? 0)) : 0);
    const amountBilled = partial ? lines.reduce((s, l) => s + Math.max(0, l.amount - (l.discount ?? 0)), 0) : Math.max(0, Number(r.amount_total) - Number(r.amount_discount));
    const amountPaid = partial ? lines.reduce((s, l) => s + linePaid(l), 0) : Number(r.amount_paid);
    const form = (doc?.form_data ?? {}) as { approval?: { staff?: string }; result?: { completedDate?: string } };
    out.push({
      id: String(r.id), period: String(r.period), category: String(r.category), status: String(r.status),
      amountBilled, amountPaid, lines, partial,
      refund: doc ? { documentId: String(doc.id), deskName: form.approval?.staff?.trim() || null, completed: !!form.result?.completedDate?.trim() } : null,
    });
  }
  return out;
}

/** 데스크 담당자로 지정할 수 있는 사람 — 같은 지점 재직 직원(강사 제외 · 수납·상담·운영 역할). */
export async function loadDeskStaff(tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data, error } = await createAdminClient().from("users").select("id,display_name")
    .eq("tenant_id", tenantId).eq("status", "active").in("system_role", ["accountant", "counselor", "manager", "admin", "master"]).order("display_name");
  if (error) throw new Error(`데스크 담당자 조회 실패: ${error.message}`);
  return (data ?? []).map(u => ({ id: String(u.id), name: String(u.display_name ?? "") })).filter(u => u.name);
}
