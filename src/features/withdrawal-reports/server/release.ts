import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction, logActionAs } from "@/features/audit/server/log";
import { pokeSlack } from "@/features/slack/server/poke";
import { reportError } from "@/lib/observability/report-error";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { completedEnrollmentIds } from "./completed-target";
import { appliedAuditMeta } from "../audit-meta";
import { missingReportSchema, REPORT_ACTION_LABEL, type WithdrawalReport } from "../model";

type Released = { reportId: string; groupId: string; tenantId: string; status?: string; error?: string };
export type ReleaseResult = { released: number; blocked: number; failed: number };
const NONE: ReleaseResult = { released: 0, blocked: 0, failed: 0 };
const SYSTEM_ACTOR = "시스템(데스크 환불 완료 확인)";

/**
 * **데스크 환불이 끝난 퇴원보고서 묶음을 처리**한다(원장 2026-11-03 · DB `release_withdrawal_report_refunds` s2_0022) —
 * 관리자 승인은 끝났고 보고서에서 요청한 환불만 남아 기다리던 묶음(또는 처리일이 된 예약)을 지금 처리한다(미래 날짜면 예약 · 정보가 바뀌었으면 재검토).
 * 부르는 곳: 수납 환불 요청서에 환불완료일자를 처음 넣었을 때 · 요청서를 지웠을 때(그 요청서 · 저장한 사람) · 처리일 cron(전체 · 시스템 — 안전망).
 * 묶음마다 감사로그(`withdrawal_report_update` · 작업 '데스크 환불 완료 · 처리' · 처리 결과)를 남기고, 처리 완료면 수학 퇴원 시트까지(승인 화면·cron과 같은 마무리).
 * 알림은 DB가 처리 함수 안에서 보낸다(요청자·담임·관리자). **던지지 않는다** — 수납 저장은 이미 끝났다(실패는 오류 보고).
 * 옛 DB(함수 없음)면 아무것도 하지 않는다(#95).
 */
export async function releaseWithdrawalRefunds(opts: { tenantId: string | null; documentId: string | null; actorId: string | null }): Promise<ReleaseResult> {
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc("release_withdrawal_report_refunds", { p_tenant: opts.tenantId, p_document: opts.documentId, p_actor: opts.actorId });
    if (missingReportSchema(error)) return NONE;
    if (error) { reportError(error, { where: "withdrawal-reports.release" }); return { ...NONE, failed: 1 }; }
    const rows = (Array.isArray(data) ? data : []) as Released[];
    const out = { ...NONE };
    for (const row of rows) {
      if (row.error || !row.status) { out.failed++; reportError(new Error(row.error ?? "처리 결과 없음"), { where: "withdrawal-reports.release", reportId: row.reportId }); continue; }
      if (row.status === "blocked") out.blocked++; else out.released++;
      await finishReleased(db, row, opts.actorId).catch((e: unknown) => { out.failed++; reportError(e, { where: "withdrawal-reports.release.finish", reportId: row.reportId }); });
    }
    if (rows.length) {
      for (const path of ["/withdrawal-reports", "/withdrawals", "/students", "/timetable", "/dashboard"]) {
        try { revalidatePath(path, "layout"); } catch { /* 요청 밖(스크립트)이면 건너뛴다 */ }
      }
    }
    return out;
  } catch (e) {
    reportError(e, { where: "withdrawal-reports.release" });
    return { ...NONE, failed: 1 };
  }
}

async function finishReleased(db: ReturnType<typeof createAdminClient>, row: Released, actorId: string | null) {
  const { data, error } = await db.from("withdrawal_reports").select("*").eq("tenant_id", row.tenantId).eq("id", row.reportId).single();
  if (error || !data) throw new Error(`처리한 보고서를 읽지 못했습니다: ${error?.message ?? "없음"}`);
  const r = data as WithdrawalReport;
  // 끝낸 수강 = 감사로그 처리 결과와 수학 퇴원 시트가 같은 값(actions.ts finish · scheduled.ts와 같은 순서 — 기록을 먼저 남긴다).
  let endedIds: string[] | null = null, endedError: unknown = null;
  if (r.status === "completed") { try { endedIds = await completedEnrollmentIds(r); } catch (e) { endedError = e; } }
  // ⚠️ 액션 키는 호출부에 리터럴로 — 감사 키 등록 가드(actions-registry.test)가 `logAction(` 괄호 안 글자만 본다.
  const detail = { targetType: "student", targetLabel: r.snapshot.name,
    metadata: { reportId: r.id, operation: r.status === "blocked" ? `${REPORT_ACTION_LABEL.release} → 변경 사항 재검토` : REPORT_ACTION_LABEL.release, date: r.effective_date, ...appliedAuditMeta(r, endedIds) } };
  if (actorId) await logAction({ action: "withdrawal_report_update", ...detail });
  else await logActionAs({ tenantId: r.tenant_id, actorName: SYSTEM_ACTOR }, { action: "withdrawal_report_update", ...detail });
  pokeSlack(r.tenant_id);
  if (r.status === "completed") {
    if (!endedIds) throw endedError;
    await recordMathWithdrawalToSheet({ tenantId: r.tenant_id, studentId: r.student_id, date: r.effective_date, enrollmentIds: endedIds });
  }
}
