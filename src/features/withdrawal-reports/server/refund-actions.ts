"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { emptyRefund, refundTitle, REFUND_FORM_TYPE } from "@/features/billing/refund-request";
import { formatPaymentLines } from "@/features/billing/refund-prefill";
import { canRequestRefund, cancelsAsDirector, missingReportSchema } from "../model";
import { reportViewer, getReport } from "./queries";
import { LINE_KEY, claimedEarlier, lineRefundable, loadDeskStaff, loadLaterInvoices, refundTag, type LaterInvoice, type LaterLine } from "./refund";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

/**
 * 퇴원보고서에서 퇴원월 뒤 청구 중 **고른 줄들**의 환불을 승인한다 = 환불 요청서를 바로 만들고, 지정한 **데스크 담당자**에게 할 일·알림을 준다.
 *
 * 원장 2026-10-29 *"11월건에 대해서 퇴원보고서 상에서 바로 환불 승인할 수 있게 토글"* · *"자동으로 환불요청서가 작성"* ·
 * *"환불승인은 원장급이상만 · 이외의 관리자는 확인만"* · *"'환불을 승인하시겠습니까?'"* · *"감사로그도"* ·
 * *"데스크 담당자를 지정할 수 있게 하면 될듯. 그럼 알림이 자연스럽게 가겠지. 내 할일에 추가되서"* ·
 * *"어떤건을 환불할건지 토글토글토글해서 선택선택선택해 그 건을 환불하게"* · *"환불건이 필요없으면… 데스크 담당자 선택하지 않아도"*(고른 줄이 없으면 이 액션 자체를 부르지 않는다).
 * - 권한(원장 2026-11-03 — 종전 원장만): `canRequestRefund` — 그 묶음의 관리자 · 요청자 · 관리자 승인을 생략한 보고서의 작성 강사 · 원장급
 *   (`cancelsAsDirector` — master · 강사 화면 아님) + 퇴원보고서 쓰기 + 이 보고서를 볼 수 있음(getReport). 화면 토글과 같은 판정.
 * - 대상: 이 보고서의 퇴원 뒤 청구 줄(과목 수강종료면 끝내는 반 줄만) · 낸 돈이 있고 · 환불된 청구가 아니고 · 아직 요청서가 없는 줄. 하나라도 아니면 전부 거절.
 * - 요청서 한 장 = 고른 줄 전부. 결재칸 담당 = 데스크 담당자 · 원장(원장급이 승인) 또는 부원장(그 밖의 관리자) = 승인한 사람. 총 환불금액 = 고른 줄로 낸 금액 합.
 * - **데스크 환불 단계**(원장 2026-11-03 · s2_0020 `attach_withdrawal_report_refund`): 요청서를 보고서에 잇는다 — 처리 전 묶음이면 환불완료일자가
 *   들어갈 때까지 퇴원·수강종료를 기다린다(수납의 환불완료 저장이 `releaseWithdrawalRefunds`로 이어 처리). 처리가 끝난 보고서는 기다리게 하지 않는다.
 *   잇기가 실패해도 요청서·할 일·알림은 그대로 간다(기록으로 알리고 화면엔 안내) — 옛 DB(s2_0020 전)도 종전처럼 돈다(#95).
 * - 할 일: `refund_desk_task_open`(s2_0011) — 환불완료일자를 넣으면 처리됨. 알림: 데스크 담당자 한 사람(자기 자신은 고를 수 없음).
 * - 감사로그: `withdrawal_refund_approve`(퇴원보고서 쪽 · 데스크 단계 여부) + `refund_request_create`(요청서 쪽).
 */
export async function approveWithdrawalRefund(reportId: string, keys: string[], deskId: string): Promise<{ ok: true; documentId: string } | { error: string }> {
  if (![reportId, deskId].every(v => /^[0-9a-f-]{36}$/i.test(v))) return { error: "요청 내용을 확인해 주세요." };
  if (!Array.isArray(keys) || !keys.length || keys.length > 40 || !keys.every(k => typeof k === "string" && LINE_KEY.test(k))) return { error: "환불할 건을 골라 주세요." };
  const picked = [...new Set(keys)];
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 처리할 수 없습니다." };
  const record = await getReport(reportId);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  const report = record.report;
  if (report.status === "canceled") return { error: "취소된 보고서입니다." };
  const directorLevel = cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId);
  if (!canRequestRefund(report, viewer.user.id, viewer.writable, directorLevel))
    return { error: "환불 승인은 이 보고서의 관리자·요청자(관리자 승인을 생략한 보고서는 작성 강사)·원장이 할 수 있습니다." };
  const [later, desks] = await Promise.all([loadLaterInvoices(report), loadDeskStaff(report.tenant_id)]);
  const desk = desks.find(d => d.id === deskId && d.id !== viewer.user.id);
  if (!desk) return { error: "데스크 담당자를 다시 골라 주세요." };
  const chosen = pick(later, picked);
  if ("error" in chosen) return chosen;

  const admin = createAdminClient();
  const { data: invRows, error: invError } = await admin.from("invoices").select("id,payment_method,paid_at")
    .eq("tenant_id", report.tenant_id).in("id", [...new Set(chosen.map(c => c.inv.id))]);
  if (invError) return { error: "청구를 불러오지 못했습니다." };
  const paidInfo = new Map((invRows ?? []).map(r => [String(r.id), { method: r.payment_method as string | null, paidAt: r.paid_at as string | null }]));
  const byInvoice = new Map<string, { inv: LaterInvoice; lines: LaterLine[] }>();
  for (const c of chosen) byInvoice.set(c.inv.id, { inv: c.inv, lines: [...(byInvoice.get(c.inv.id)?.lines ?? []), c.line] });
  const payment = formatPaymentLines([...byInvoice.values()].map(({ inv, lines }) => ({
    period: inv.period, status: inv.status,
    amountTotal: lines.reduce((s, l) => s + l.amount, 0), amountDiscount: lines.reduce((s, l) => s + (l.discount ?? 0), 0),
    amountPaid: lines.reduce((s, l) => s + l.paidNet, 0),
    paymentMethod: paidInfo.get(inv.id)?.method ?? null, paidAt: paidInfo.get(inv.id)?.paidAt ?? null,
    lineItems: lines.map(l => ({ ...l, paid: l.paidNet })),
  })));
  const total = chosen.reduce((s, c) => s + c.line.paidNet, 0);
  const periods = [...new Set(chosen.map(c => c.inv.period))].join(", ");

  const snapshot = report.snapshot;
  const endedCourses = report.exit_kind === "withdrawal" ? snapshot.courses : snapshot.courses.filter(c => report.subjects.includes(c.subject));
  const data = emptyRefund();
  data.approval.staff = desk.name;
  // 승인한 사람의 결재칸 — 원장급이면 '원장', 그 밖의 관리자(관리자·요청자·작성 강사)면 '부원장' 칸(요청서 양식의 결재칸 셋: 담당·부원장·원장).
  if (directorLevel) data.approval.director = viewer.user.displayName ?? "";
  else data.approval.viceDirector = viewer.user.displayName ?? "";
  data.student.name = snapshot.name;
  data.student.schoolGrade = [snapshot.school, snapshot.grade].filter(Boolean).join(" ");
  data.student.className = [...new Set(endedCourses.map(c => c.className))].join(", ");
  data.student.homeroomTeacher = [...new Set(endedCourses.map(c => c.teacherName).filter(Boolean))].join(", ");
  data.student.reason = `${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"}(마지막 수업일 ${report.effective_date}) — ${periods} 수업을 듣지 않음. 퇴원보고서에서 환불 승인(${viewer.user.displayName ?? ""}).`;
  data.student.requestDate = kstToday();
  data.refund.paymentDetails = payment.join("\n");
  data.refund.totalAmount = won(total);

  // 같은 줄로 두 번 만들지 않게 — 넣기 직전에 한 번 더 본다(두 번 누름·두 창).
  const recheck = pick(await loadLaterInvoices(report), picked);
  if ("error" in recheck) return recheck;
  const { data: row, error } = await admin.from("academy_documents").insert({
    tenant_id: report.tenant_id, title: refundTitle(data), category: "billing", kind: "form", form_type: REFUND_FORM_TYPE,
    form_data: data, restricted: true, description: refundTag(report.id, picked), uploaded_by: viewer.user.id,
  }).select("id").single();
  if (error || !row) return { error: "환불 요청서를 만들지 못했습니다." };
  const documentId = String(row.id);
  // 동시에 두 창에서 같은 줄을 승인했으면 늦은 쪽이 물러난다(확인과 넣기 사이의 틈 — 리뷰 2026-10-29).
  // 확인 조회가 실패하면 지우지 않고 그대로 간다(넣기 직전 확인은 이미 통과했다).
  const lost = await claimedEarlier(report.tenant_id, documentId, picked).catch((e: unknown) => { console.error("[withdrawal-refund] 겹침 확인 실패", e); return false; });
  if (lost) {
    const { error: undoError } = await admin.from("academy_documents").delete().eq("tenant_id", report.tenant_id).eq("id", documentId);
    if (undoError) {
      // 지우지 못한 요청서는 남는다 — 감사로그로 흔적을 남기고 확인을 부탁한다.
      console.error("[withdrawal-refund] 겹친 요청서 되돌리기 실패", undoError.message);
      await logAction({ action: "refund_request_create", targetType: "refund_request", targetLabel: refundTitle(data),
        metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, source: "퇴원보고서 환불 승인 — 동시 승인 겹침, 되돌리기 실패(확인 필요)" } });
      return { error: "같은 건이 다른 창에서도 승인되어 겹친 환불 요청서가 남았습니다. 환불 요청 목록에서 확인해 주세요." };
    }
    return { error: "같은 건을 방금 다른 창에서 승인했습니다. 새로고침 후 확인해 주세요." };
  }

  // 데스크 환불 단계 — 요청서를 보고서에 잇는다(처리 전 묶음이면 환불 완료까지 처리를 기다린다 · s2_0020). 실패해도 요청서·할 일·알림은 간다.
  const link = await attachRefundStep(report.tenant_id, viewer.user.id, report.id, documentId, desk.id);

  const items = chosen.map(c => `${c.inv.period} ${c.line.description.trim()} ${won(c.line.paidNet)}`);
  const meta = { reportId: report.id, documentId, items, totalAmount: data.refund.totalAmount, effectiveDate: report.effective_date, deskId: desk.id, deskName: desk.name,
    deskStep: link.gates ? "데스크 환불 완료 뒤 처리" : link.ok ? "처리를 기다리지 않음" : `데스크 단계 연결 실패 — ${link.error}` };
  await logAction({ action: "withdrawal_refund_approve", targetType: "student", targetLabel: snapshot.name, metadata: meta });
  await logAction({ action: "refund_request_create", targetType: "refund_request", targetLabel: refundTitle(data),
    metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, requestDate: data.student.requestDate, source: "퇴원보고서 환불 승인" } });

  const title = `${snapshot.name} 환불 처리`;
  const detail = `${periods} ${chosen.length}건 ${won(total)} · ${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"} ${report.effective_date} · ${viewer.user.displayName ?? ""} 승인${link.gates ? " · 환불 처리 뒤 퇴원 처리" : ""}`;
  const { data: taskId } = await admin.rpc("refund_desk_task_open", {
    p_tenant: report.tenant_id, p_document: documentId, p_assignee: desk.id, p_title: title, p_detail: detail, p_actor: viewer.user.id,
  }).then(r => { if (r.error) console.error("[withdrawal-refund] 할 일 만들기 실패", r.error.message); return r; },
    (e: unknown) => { console.error("[withdrawal-refund] 할 일 만들기 실패", e); return { data: null }; });
  await notifyUsers([{ tenantId: report.tenant_id, recipientId: desk.id, type: "refund_request_approved", title: `${title} — 퇴원보고서 환불 승인`,
    body: `${detail}. 환불 요청서를 확인하고 처리해 주세요.${link.gates ? " 환불완료일자를 넣으면 퇴원·수강종료가 이어서 처리됩니다." : ""}`, link: `/billing/refunds/${documentId}`, actorId: viewer.user.id,
    taskId: typeof taskId === "string" ? taskId : null }]);

  revalidatePath("/withdrawal-reports", "layout");
  revalidatePath("/billing");
  return { ok: true, documentId };
}

/** 데스크 환불 단계 잇기(s2_0020) — 처리 전 묶음이면 `gates`. 옛 DB(함수 없음)·실패는 `ok: false`(호출부가 기록만 남기고 계속). */
async function attachRefundStep(tenantId: string, actorId: string, reportId: string, documentId: string, deskId: string): Promise<{ ok: boolean; gates: boolean; error?: string }> {
  const { data, error } = await createAdminClient().rpc("attach_withdrawal_report_refund", { p_tenant: tenantId, p_actor: actorId, p_report: reportId, p_document: documentId, p_desk: deskId })
    .then(r => r, (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e), code: "" } }));
  if (error) {
    console.error("[withdrawal-refund] 데스크 환불 단계 연결 실패", error.message);
    return { ok: false, gates: false, error: missingReportSchema(error) ? "DB 준비 전(s2_0020)" : error.message };
  }
  return { ok: true, gates: !!(data as { gates?: boolean } | null)?.gates };
}

/** 고른 줄 → (청구, 줄). 하나라도 이 보고서의 환불 가능한 줄이 아니면 거절한다. */
function pick(later: LaterInvoice[], keys: string[]): { inv: LaterInvoice; line: LaterLine }[] | { error: string } {
  const out: { inv: LaterInvoice; line: LaterLine }[] = [];
  for (const key of keys) {
    const inv = later.find(i => i.lines.some(l => l.key === key));
    const line = inv?.lines.find(l => l.key === key);
    if (!inv || !line) return { error: "퇴원월 뒤 청구 줄이 아닙니다. 새로고침 후 다시 골라 주세요." };
    if (line.refund) return { error: "이미 환불 요청서가 있는 건이 섞여 있습니다. 새로고침 후 다시 골라 주세요." };
    if (!lineRefundable(inv, line)) return { error: "낸 금액이 없거나 이미 환불된 건이 섞여 있습니다." };
    out.push({ inv, line });
  }
  return out;
}
