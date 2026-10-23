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

export async function applyDueWithdrawalReports() {
  const db = createAdminClient();
  const { data, error } = await db.from("withdrawal_reports").select("id,tenant_id")
    .eq("status", "scheduled").or("group_id.is.null,group_leader.eq.true").lte("effective_date", kstToday()).order("effective_date").limit(200);
  if (missingReportSchema(error)) return { applied: 0, blocked: 0, failed: 0 };
  if (error) { reportError(error, { where: "withdrawal-reports.due" }); return { applied: 0, blocked: 0, failed: 1 }; }
  let applied = 0, blocked = 0, failed = 0;
  for (const row of data ?? []) {
    const { data: changed, error: err } = await db.rpc("transition_withdrawal_report", { p_tenant: row.tenant_id, p_actor: null, p_report: row.id, p_action: "apply", p_payload: {} }).single();
    if (err) { failed++; reportError(err, { where: "withdrawal-reports.apply", reportId: row.id }); continue; }
    const r = changed as WithdrawalReport;
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
  return { applied, blocked, failed };
}
