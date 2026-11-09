import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { missingReportSchema, type WithdrawalReport } from "../model";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { pokeSlack } from "@/features/slack/server/poke";
import { logActionAs } from "@/features/audit/server/log";
import { reportError } from "@/lib/observability/report-error";
import { completedEnrollmentIds } from "./completed-target";
import { appliedAuditMeta } from "../audit-meta";
import { releaseWithdrawalRefunds } from "./release";
import { loadGroupRefundCheck, refundGateReady } from "./refund-check";
import type { RefundCheck } from "../refund-decision";

/**
 * 처리일이 된 예약 보고서 처리(매일 00:05 cron) + **환불 확인이 끝난 묶음 처리**(안전망 — 수납 저장·원장 결정 뒤 처리가 놓친 것 ·
 * s2_0036 적용과 새 앱 배포 사이에 옛 앱이 승인만 하고 처리하지 않은 묶음).
 * 🔴 처리일 apply는 묶음마다 **이 요청 안에서** 환불 확인 값(`loadGroupRefundCheck`)을 계산해 함께 넘긴다(원장 2026-11-06) — DB는 확인 값이 없거나
 *    원장이 결정하지 않은 환불 가능 줄이 있으면 처리하지 않고 그대로 돌려준다('환불 결정 대기' 표시 · 원장 알림·할 일). 확인 값을 못 만들면 넘기지 않는다(실패로 센다).
 * 데스크 환불·환불 결정이 남은 예약은 DB가 그대로 돌려준다(오류 없음) → '미룸'으로 세고 기록하지 않는다(날마다 같은 기록이 쌓이지 않게).
 */
export async function applyDueWithdrawalReports() {
  // 새 앱 + 옛 DB(s2_0036 전)면 처리일 apply를 부르지 않는다 — 옛 처리 함수는 확인 값을 모른 채 처리한다(리뷰 #5).
  try { if (!(await refundGateReady())) { reportError(new Error("퇴원보고서 환불 관문 SQL(s2_0036) 적용 전 — 처리일 처리를 미룹니다."), { where: "withdrawal-reports.due.ready" }); return { applied: 0, blocked: 0, failed: 1, deferred: 0, released: 0 }; } }
  catch (e) { reportError(e, { where: "withdrawal-reports.due.ready" }); return { applied: 0, blocked: 0, failed: 1, deferred: 0, released: 0 }; }
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_reports").select("id,tenant_id,group_id")
    .eq("status", "scheduled").or("group_id.is.null,group_leader.eq.true").lte("effective_date", kstToday()).order("effective_date").limit(200);
  if (missingReportSchema(error)) return { applied: 0, blocked: 0, failed: 0, deferred: 0, released: 0 };
  if (error) { reportError(error, { where: "withdrawal-reports.due" }); return { applied: 0, blocked: 0, failed: 1, deferred: 0, released: 0 }; }
  let applied = 0, blocked = 0, failed = 0, deferred = 0;
  for (const row of data ?? []) {
    let refundCheck: RefundCheck | null = null;
    if (row.group_id) {
      try { refundCheck = await loadGroupRefundCheck(String(row.tenant_id), String(row.group_id)); }
      catch (e) { failed++; reportError(e, { where: "withdrawal-reports.apply.check", reportId: row.id }); continue; }
    }
    const { data: changed, error: err } = await db.rpc("transition_withdrawal_report", { p_tenant: row.tenant_id, p_actor: null, p_report: row.id, p_action: "apply", p_payload: refundCheck ? { refundCheck } : {} }).single();
    if (err) { failed++; reportError(err, { where: "withdrawal-reports.apply", reportId: row.id }); continue; }
    const r = changed as WithdrawalReport;
    if (r.status === "scheduled") { deferred++; continue; }
    // 끝낸 수강 = 감사로그 처리 결과(appliedAuditMeta)와 수학 퇴원 시트가 같은 값. 못 읽어도 기록을 먼저 남기고 종전처럼 멈춘다.
    let endedIds: string[] | null = null, endedError: unknown = null;
    if (r.status === "completed") { applied++; try { endedIds = await completedEnrollmentIds(r); } catch (e) { endedError = e; } }
    else blocked++;
    await logActionAs({ tenantId: r.tenant_id, actorName: "시스템(퇴원보고서 처리일 도래)" }, {
      action: "withdrawal_report_update", targetType: "student", targetLabel: r.snapshot.name,
      metadata: { reportId: r.id, operation: r.status === "completed" ? "퇴원·수강종료 처리" : "변경 사항 재검토", date: r.effective_date,
        ...appliedAuditMeta(r, endedIds) },
    });
    if (r.status === "completed") {
      if (!endedIds) throw endedError;
      await recordMathWithdrawalToSheet({ tenantId: r.tenant_id, studentId: r.student_id, date: r.effective_date, enrollmentIds: endedIds });
    }
    pokeSlack(r.tenant_id);
  }
  // 승인이 다 끝났는데 처리되지 않은 묶음(데스크 환불 완료 뒤 처리 실패 · 원장 결정 뒤 처리 실패 · 옛 앱이 확인 값 없이 승인) — 지점 전체 · 시스템 행위자.
  const release = await releaseWithdrawalRefunds({ tenantId: null, documentId: null, actorId: null });
  return { applied, blocked: blocked + release.blocked, failed: failed + release.failed, deferred, released: release.released };
}
