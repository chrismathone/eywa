"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { emptyRefund, refundTitle, REFUND_FORM_TYPE } from "@/features/billing/refund-request";
import { formatPaymentLines } from "@/features/billing/refund-prefill";
import { toPrefillLines } from "@/features/billing/server/refund-queries";
import { cancelsAsDirector } from "../model";
import { reportViewer, getReport } from "./queries";
import { loadLaterInvoices, refundTag } from "./refund";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 퇴원보고서에서 퇴원월 뒤 청구의 **환불을 승인**한다 = 환불 요청서를 바로 만든다(원장 결재칸에 승인자 이름).
 *
 * 원장 2026-10-29 *"11월건에 대해서 퇴원보고서 상에서 바로 환불 승인할 수 있게 토글"* · *"자동으로 환불요청서가 작성"* ·
 * *"환불승인은 원장급이상만 · 이외의 관리자는 이러한 요소가 있는지 확인만"* · *"실제로 환불요청을 관리하는 사람에게도 알림"* ·
 * *"당연히 감사로그도"*.
 * - 권한: 원장(`cancelsAsDirector` — master · 강사 화면 아님) + 퇴원보고서 쓰기. 이 보고서를 볼 수 있어야 한다(getReport).
 * - 대상: 이 보고서 학생의 퇴원월 **뒤** 청구 · 낸 돈이 있고 · 환불 상태가 아닌 것. 같은 청구로 두 번 만들지 않는다.
 * - 알림: 수납 담당 = 원장(master) + 회계(accountant) 활성 전원(미수 알림과 같은 기준 · 본인 제외).
 * - 감사로그: `withdrawal_refund_approve`(퇴원보고서 쪽) + `refund_request_create`(요청서 쪽 — 환불 요청서 이력이 한곳에 모이게).
 */
export async function approveWithdrawalRefund(reportId: string, invoiceId: string): Promise<{ ok: true; documentId: string; already?: true } | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId) || !/^[0-9a-f-]{36}$/i.test(invoiceId)) return { error: "요청 내용을 확인해 주세요." };
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 처리할 수 없습니다." };
  if (!cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId)) return { error: "환불 승인은 원장만 할 수 있습니다." };
  const record = await getReport(reportId);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  const report = record.report;
  if (report.status === "canceled") return { error: "취소된 보고서입니다." };
  const later = await loadLaterInvoices(report);
  const target = later.find(i => i.id === invoiceId);
  if (!target) return { error: "퇴원월 뒤 청구가 아닙니다." };
  if (target.refundDocId) return { ok: true, documentId: target.refundDocId, already: true };
  if (target.status === "refunded") return { error: "이미 환불된 청구입니다." };
  if (target.amountPaid <= 0) return { error: "낸 금액이 없는 청구입니다." };

  const admin = createAdminClient();
  const { data: inv, error: invError } = await admin.from("invoices")
    .select("period,status,amount_total,amount_paid,amount_discount,payment_method,paid_at,line_items")
    .eq("tenant_id", report.tenant_id).eq("id", invoiceId).maybeSingle();
  if (invError || !inv) return { error: "청구를 불러오지 못했습니다." };
  const payment = formatPaymentLines([{ period: String(inv.period), status: String(inv.status), amountTotal: Number(inv.amount_total), amountPaid: Number(inv.amount_paid),
    amountDiscount: Number(inv.amount_discount), paymentMethod: inv.payment_method as string | null, paidAt: inv.paid_at as string | null, lineItems: toPrefillLines(inv.line_items) }]);

  const snapshot = report.snapshot;
  const data = emptyRefund();
  data.approval.director = viewer.user.displayName ?? "";
  data.student.name = snapshot.name;
  data.student.schoolGrade = [snapshot.school, snapshot.grade].filter(Boolean).join(" ");
  data.student.className = [...new Set(snapshot.courses.map(c => c.className))].join(", ");
  data.student.homeroomTeacher = [...new Set(snapshot.courses.map(c => c.teacherName).filter(Boolean))].join(", ");
  data.student.reason = `${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"}(${report.effective_date}) — ${target.period} 수업을 듣지 않음. 퇴원보고서에서 원장 환불 승인.`;
  data.student.requestDate = kstToday();
  data.refund.paymentDetails = payment.join("\n");
  data.refund.totalAmount = won(target.amountPaid);

  // 같은 청구로 두 번 만들지 않게 — 넣기 직전에 한 번 더 본다(두 번 누름·두 창).
  const { data: dup } = await admin.from("academy_documents").select("id").eq("tenant_id", report.tenant_id)
    .eq("form_type", REFUND_FORM_TYPE).like("description", `%invoice:${invoiceId}%`).limit(1);
  if (dup?.length) return { ok: true, documentId: String(dup[0].id), already: true };
  const { data: row, error } = await admin.from("academy_documents").insert({
    tenant_id: report.tenant_id, title: refundTitle(data), category: "billing", kind: "form", form_type: REFUND_FORM_TYPE,
    form_data: data, restricted: true, description: refundTag(report.id, invoiceId), uploaded_by: viewer.user.id,
  }).select("id").single();
  if (error || !row) return { error: "환불 요청서를 만들지 못했습니다." };
  const documentId = String(row.id);

  const meta = { reportId: report.id, documentId, invoicePeriod: target.period, totalAmount: data.refund.totalAmount, effectiveDate: report.effective_date };
  await logAction({ action: "withdrawal_refund_approve", targetType: "student", targetLabel: snapshot.name, metadata: meta });
  await logAction({ action: "refund_request_create", targetType: "refund_request", targetLabel: refundTitle(data),
    metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, requestDate: data.student.requestDate, source: "퇴원보고서 원장 승인" } });

  const { data: staff } = await admin.from("users").select("id").eq("tenant_id", report.tenant_id).eq("status", "active").in("system_role", ["master", "accountant"]);
  await notifyUsers((staff ?? []).map(u => ({
    tenantId: report.tenant_id, recipientId: String(u.id), type: "refund_request_approved" as const,
    title: `${snapshot.name} 환불 요청 — 원장 승인`,
    body: `${target.period} 청구 ${won(target.amountPaid)} · ${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"} ${report.effective_date} · 환불 처리를 진행해 주세요.`,
    link: `/billing/refunds/${documentId}`, actorId: viewer.user.id,
  })));

  revalidatePath(`/withdrawal-reports/${report.id}`);
  revalidatePath("/billing");
  return { ok: true, documentId };
}
