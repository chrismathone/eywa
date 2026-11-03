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
 * - 권한: **원장급만**(`canRequestRefund` — `cancelsAsDirector` · master · 강사 화면 아님) + 퇴원보고서 쓰기 + 이 보고서를 볼 수 있음(getReport).
 *   관리자·요청자·작성 강사는 확인만(원장 2026-10-29 · 2026-11-03 다시 확인). 화면 토글과 같은 판정.
 * - 대상: 이 보고서의 퇴원 뒤 청구 줄(과목 수강종료면 끝내는 반 줄만) · 낸 돈이 있고 · 환불된 청구가 아니고 · 아직 요청서가 없는 줄. 하나라도 아니면 전부 거절.
 * - 요청서 한 장 = 고른 줄 전부. 결재칸 담당 = 데스크 담당자 · 원장 = 승인한 원장급. 총 환불금액 = 고른 줄로 낸 금액 합.
 * - **데스크 환불 단계**(원장 2026-11-03 · s2_0020 `attach_withdrawal_report_refund`): 요청서를 보고서에 잇는다 — 처리 전 묶음이면 환불완료일자가
 *   들어갈 때까지 퇴원·수강종료를 기다린다(수납의 환불완료 저장이 `releaseWithdrawalRefunds`로 이어 처리). 처리가 끝난 보고서는 기다리게 하지 않는다.
 *   🔴 **원자적으로**: 잇기가 실패하면(그 사이 묶음이 처리·재검토·취소됨 · DB 준비 전 등) 방금 만든 요청서를 지우고(감사로그) 오류를 돌려준다 —
 *   요청서만 남고 기다림이 걸리지 않는 일이 없게. 할 일·알림은 잇기가 끝난 뒤에만 만든다. 화면이 본 상태(처리 전인가)를 DB에 넘겨 같이 대조한다.
 * - 할 일: `refund_desk_task_open`(s2_0011) — 환불완료일자를 넣으면 처리됨. 알림: 데스크 담당자 한 사람(자기 자신은 고를 수 없음).
 * - 감사로그: `withdrawal_refund_approve`(퇴원보고서 쪽 · 데스크 단계 여부) + `refund_request_create`(요청서 쪽).
 */
export async function approveWithdrawalRefund(reportId: string, keys: string[], deskId: string): Promise<{ ok: true; documentId: string; gates: boolean } | { error: string }> {
  if (![reportId, deskId].every(v => /^[0-9a-f-]{36}$/i.test(v))) return { error: "요청 내용을 확인해 주세요." };
  if (!Array.isArray(keys) || !keys.length || keys.length > 40 || !keys.every(k => typeof k === "string" && LINE_KEY.test(k))) return { error: "환불할 건을 골라 주세요." };
  const picked = [...new Set(keys)];
  const viewer = await reportViewer();
  if (!viewer?.writable) return { error: "이 화면에서는 처리할 수 없습니다." };
  const record = await getReport(reportId);
  if (!record) return { error: "보고서에 접근할 수 없습니다." };
  const report = record.report;
  if (report.status === "canceled") return { error: "취소된 보고서입니다." };
  if (!canRequestRefund(report, viewer.writable, cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId))) return { error: "환불 승인은 원장만 할 수 있습니다." };
  // 화면이 본 상태 — 처리 전(묶음이 진행 중·처리 예약)이면 이 환불이 끝나야 처리한다. DB가 같은 판정으로 다시 대조한다(attach).
  const expectGate = !!report.group_id && !["completed", "blocked", "canceled"].includes(report.status);
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
  data.approval.director = viewer.user.displayName ?? "";
  data.student.name = snapshot.name;
  data.student.schoolGrade = [snapshot.school, snapshot.grade].filter(Boolean).join(" ");
  data.student.className = [...new Set(endedCourses.map(c => c.className))].join(", ");
  data.student.homeroomTeacher = [...new Set(endedCourses.map(c => c.teacherName).filter(Boolean))].join(", ");
  data.student.reason = `${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"}(마지막 수업일 ${report.effective_date}) — ${periods} 수업을 듣지 않음. 퇴원보고서에서 원장 환불 승인.`;
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

  // 데스크 환불 단계 — 요청서를 보고서에 잇는다(처리 전 묶음이면 환불 완료까지 처리를 기다린다 · s2_0020). 실패하면 요청서를 지우고 그만둔다.
  let link = await attachRefundStep(report.tenant_id, viewer.user.id, report.id, documentId, desk.id, expectGate);
  if (!link.ok) {
    // DB에선 이어졌는데 응답만 잃었을 수 있다 — 지우기 전에 실제로 이어졌는지 한 번 더 본다(이어졌으면 지우지 않고 그대로 간다).
    const recheck = await linkedStep(report.tenant_id, documentId);
    if (recheck.linked) link = { ok: true, gates: recheck.gates };
    else {
      const left = recheck.unknown ? null : await admin.from("academy_documents").delete().eq("tenant_id", report.tenant_id).eq("id", documentId).select("id");
      const removed = !!left && !left.error && (left.data ?? []).length > 0;
      if (!removed) {
        // 요청서가 남았다 — 그 요청서의 생성 기록을 남겨 수납에서 찾을 수 있게(지우지 못한 것을 '삭제'로 적지 않는다).
        await logAction({ action: "refund_request_create", targetType: "refund_request", targetLabel: refundTitle(data),
          metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, requestDate: data.student.requestDate,
            source: recheck.unknown ? "퇴원보고서 환불 승인 · 보고서 연결 여부 확인 실패 — 요청서가 남음(확인 필요)" : "퇴원보고서 환불 승인 · 보고서 연결 실패 · 되돌리기 실패 — 요청서가 남음(확인 필요)",
            reason: link.error } });
        return { error: `데스크 환불 단계에 잇지 못했고, 만든 환불 요청서가 남았습니다. 환불 요청 목록에서 확인해 주세요. (${link.error ?? "연결 실패"})` };
      }
      await logAction({ action: "refund_request_delete", targetType: "refund_request", targetLabel: refundTitle(data),
        metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, source: "퇴원보고서 환불 승인 — 데스크 단계 연결 실패로 되돌림", reason: link.error } });
      return { error: link.error ?? "데스크 환불 단계에 잇지 못했습니다. 새로고침 후 다시 확인해 주세요." };
    }
  }

  const items = chosen.map(c => `${c.inv.period} ${c.line.description.trim()} ${won(c.line.paidNet)}`);
  const meta = { reportId: report.id, documentId, items, totalAmount: data.refund.totalAmount, effectiveDate: report.effective_date, deskId: desk.id, deskName: desk.name,
    deskStep: link.gates ? "데스크 환불 완료 뒤 처리" : "처리를 기다리지 않음" };
  await logAction({ action: "withdrawal_refund_approve", targetType: "student", targetLabel: snapshot.name, metadata: meta });
  await logAction({ action: "refund_request_create", targetType: "refund_request", targetLabel: refundTitle(data),
    metadata: { documentId, studentName: snapshot.name, totalAmount: data.refund.totalAmount, requestDate: data.student.requestDate, source: "퇴원보고서 환불 승인" } });

  const title = `${snapshot.name} 환불 처리`;
  const detail = `${periods} ${chosen.length}건 ${won(total)} · ${report.exit_kind === "withdrawal" ? "퇴원" : "수강종료"} · 마지막 수업일 ${report.effective_date} · 원장 승인${link.gates ? " · 환불 처리 뒤 퇴원 처리" : ""}`;
  const { data: taskId } = await admin.rpc("refund_desk_task_open", {
    p_tenant: report.tenant_id, p_document: documentId, p_assignee: desk.id, p_title: title, p_detail: detail, p_actor: viewer.user.id,
  }).then(r => { if (r.error) console.error("[withdrawal-refund] 할 일 만들기 실패", r.error.message); return r; },
    (e: unknown) => { console.error("[withdrawal-refund] 할 일 만들기 실패", e); return { data: null }; });
  await notifyUsers([{ tenantId: report.tenant_id, recipientId: desk.id, type: "refund_request_approved", title: `${title} — 데스크 환불 요청`,
    body: `${detail}. 환불 요청서를 확인하고 처리해 주세요.${link.gates ? " 환불완료일자를 넣으면 퇴원·수강종료가 이어서 처리됩니다." : ""}`, link: `/billing/refunds/${documentId}`, actorId: viewer.user.id,
    taskId: typeof taskId === "string" ? taskId : null }]);

  revalidatePath("/withdrawal-reports", "layout");
  revalidatePath("/billing");
  return { ok: true, documentId, gates: link.gates };
}

/** 그 요청서가 보고서에 실제로 이어졌나(연결 응답을 잃었을 때) — 이어졌으면 묶음이 처리 전(진행 중·처리 예약)인지까지. 못 읽으면 `unknown`(지우지 않는다). */
async function linkedStep(tenantId: string, documentId: string): Promise<{ linked: boolean; gates: boolean; unknown?: true }> {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_report_refunds").select("group_id").eq("tenant_id", tenantId).eq("document_id", documentId).maybeSingle();
  if (error) return missingReportSchema(error) ? { linked: false, gates: false } : { linked: false, gates: false, unknown: true };
  if (!data) return { linked: false, gates: false };
  if (!data.group_id) return { linked: true, gates: false };
  const { data: group, error: groupError } = await db.from("withdrawal_report_groups").select("status").eq("tenant_id", tenantId).eq("id", data.group_id).maybeSingle();
  return { linked: true, gates: !groupError && ["pending", "scheduled"].includes(String(group?.status ?? "")) };
}

/** 데스크 환불 단계 잇기(s2_0020) — 처리 전 묶음이면 `gates`. 화면이 본 상태와 다르거나 옛 DB(함수 없음)·실패면 `ok: false`(호출부가 요청서를 지운다). */
async function attachRefundStep(tenantId: string, actorId: string, reportId: string, documentId: string, deskId: string, expectGate: boolean): Promise<{ ok: boolean; gates: boolean; error?: string }> {
  const { data, error } = await createAdminClient().rpc("attach_withdrawal_report_refund", { p_tenant: tenantId, p_actor: actorId, p_report: reportId, p_document: documentId, p_desk: deskId, p_expect_gate: expectGate })
    .then(r => r, (e: unknown) => ({ data: null, error: { message: e instanceof Error ? e.message : String(e), code: "" } }));
  if (error) {
    console.error("[withdrawal-refund] 데스크 환불 단계 연결 실패", error.message);
    return { ok: false, gates: false, error: missingReportSchema(error) ? "데스크 환불 단계를 준비 중입니다(DB 적용 전). 잠시 후 다시 시도해 주세요." : error.message };
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
