import "server-only";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction, logActionAs } from "@/features/audit/server/log";
import { pokeSlack } from "@/features/slack/server/poke";
import { reportError } from "@/lib/observability/report-error";
import { recordMathWithdrawalToSheet } from "@/features/withdrawals/server/withdrawal-sheet";
import { kstToday } from "@/lib/date-kst";
import { completedEnrollmentIds } from "./completed-target";
import { appliedAuditMeta } from "../audit-meta";
import { missingReportSchema, REPORT_ACTION_LABEL, type WithdrawalReport } from "../model";
import type { RefundCheck } from "../refund-decision";
import { loadGroupRefundCheck, refundGateReady } from "./refund-check";

type Released = { reportId: string; groupId: string; tenantId: string; status?: string; groupStatus?: string; error?: string };
export type ReleaseResult = { released: number; blocked: number; failed: number };
const NONE: ReleaseResult = { released: 0, blocked: 0, failed: 0 };
const SYSTEM_ACTOR = "시스템(환불 확인 뒤 처리)";
type Db = ReturnType<typeof createAdminClient>;

/**
 * **환불 확인이 끝난 퇴원보고서 묶음을 처리**한다(DB `release_withdrawal_report_refunds` — s2_0025 · s2_0036) —
 * 관리자 승인은 끝났고(또는 처리일이 된 예약) 데스크 환불·원장 환불 결정이 남아 기다리던 묶음을 지금 처리한다(미래 날짜면 예약 · 정보가 바뀌었으면 재검토).
 * 🔴 묶음마다 **이 요청 안에서** 환불 확인 값(`loadGroupRefundCheck`)을 계산해 함께 넘긴다 — DB는 확인 값이 있는 묶음만, 결정 안 된 환불 가능 줄이 0일 때만
 *    처리한다(원장 2026-11-06). 확인 값을 못 만든 묶음은 넘기지 않는다(처리하지 않는 쪽 · 오류 보고). 확인 값은 처리 전 묶음의 '환불 결정 대기' 표시도 맞춘다 —
 *    이어진 요청서를 지우면 그 줄이 다시 결정 안 됨이 되어 대기로 돌아간다(원장 할 일 다시).
 * 부르는 곳: 수납 환불 요청서에 환불완료일자를 처음 넣었을 때 · 요청서를 지웠을 때(그 요청서에 이어진 묶음 · 저장한 사람) ·
 *   처리일 cron(전체 · 시스템 — 안전망: 승인이 끝났는데 처리 안 된 묶음 · 처리일이 된 예약).
 * 묶음마다 감사로그(`withdrawal_report_update` · 작업 '환불 확인 뒤 처리' · 처리 결과)를 남기고, 처리 완료면 수학 퇴원 시트까지(승인 화면·cron과 같은 마무리).
 * 알림은 DB가 처리 함수 안에서 보낸다(요청자·담임·관리자). **던지지 않는다** — 수납 저장은 이미 끝났다(실패는 오류 보고).
 * 옛 DB(함수 없음)면 아무것도 하지 않는다(#95).
 */
export async function releaseWithdrawalRefunds(opts: { tenantId: string | null; documentId: string | null; actorId: string | null }): Promise<ReleaseResult> {
  try {
    // 새 앱 + 옛 DB(s2_0036 전)면 부르지 않는다(리뷰 #5 — 옛 release는 확인 값을 모른다).
    if (!(await refundGateReady())) return NONE;
    const db = createAdminClient();
    const groups = await candidateGroups(db, opts);
    if (!groups.length) return NONE;
    // 묶음마다 확인 값을 계산하고 **바로** 처리 함수를 부른다(리뷰 #14) — 여러 묶음을 다 계산한 뒤 한 번에 부르면 앞 묶음의 확인 값이 낡는다.
    const total = { ...NONE };
    for (const g of groups) {
      let check: RefundCheck;
      try { check = await loadGroupRefundCheck(g.tenantId, g.id); }
      catch (e) { total.failed++; reportError(e, { where: "withdrawal-reports.release.check", groupId: g.id }); continue; }
      const out = await runRelease(db, opts, { [g.id]: check });
      total.released += out.released; total.blocked += out.blocked; total.failed += out.failed;
    }
    return total;
  } catch (e) {
    reportError(e, { where: "withdrawal-reports.release" });
    return { ...NONE, failed: 1 };
  }
}

/** 한 묶음을 이미 계산한 확인 값으로(원장 '환불 없음' 직후 — 같은 요청에서 계산한 값) 처리한다. 던지지 않는다. */
export async function releaseWithdrawalGroup(opts: { tenantId: string; groupId: string; actorId: string; check: RefundCheck }): Promise<ReleaseResult> {
  try {
    return await runRelease(createAdminClient(), { tenantId: opts.tenantId, documentId: null, actorId: opts.actorId }, { [opts.groupId]: opts.check });
  } catch (e) {
    reportError(e, { where: "withdrawal-reports.release.group", groupId: opts.groupId });
    return { ...NONE, failed: 1 };
  }
}

/**
 * 확인 값을 계산할 묶음 — 요청서를 주면 그 요청서에 이어진 처리 전 묶음(완료 입력 · 삭제), 아니면 처리할 차례인 묶음
 * (승인이 다 끝났는데 처리 안 된 진행 중 묶음 · 처리일이 된 예약 — cron 안전망).
 */
async function candidateGroups(db: Db, opts: { tenantId: string | null; documentId: string | null }): Promise<{ id: string; tenantId: string }[]> {
  if (opts.documentId) {
    let q = db.from("withdrawal_report_refunds").select("group_id,tenant_id").eq("document_id", opts.documentId);
    if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
    const { data, error } = await q.limit(20);
    if (missingReportSchema(error)) return [];
    if (error) throw new Error(`환불 연결 조회 실패: ${error.message}`);
    const ids = [...new Set((data ?? []).flatMap(r => r.group_id ? [String(r.group_id)] : []))];
    if (!ids.length) return [];
    const { data: groups, error: groupError } = await db.from("withdrawal_report_groups").select("id,tenant_id").in("id", ids).in("status", ["pending", "scheduled"]);
    if (groupError) throw new Error(`묶음 조회 실패: ${groupError.message}`);
    return (groups ?? []).map(g => ({ id: String(g.id), tenantId: String(g.tenant_id) }));
  }
  let q = db.from("withdrawal_report_groups").select("id,tenant_id,status,effective_date").in("status", ["pending", "scheduled"]);
  if (opts.tenantId) q = q.eq("tenant_id", opts.tenantId);
  const { data, error } = await q.order("created_at").limit(500);
  if (missingReportSchema(error)) return [];
  if (error) throw new Error(`묶음 조회 실패: ${error.message}`);
  const rows = (data ?? []) as { id: string; tenant_id: string; status: string; effective_date: string }[];
  const pending = rows.filter(g => g.status === "pending").map(g => g.id);
  const notApproved = new Set<string>();
  if (pending.length) {
    const { data: reports, error: reportError_ } = await db.from("withdrawal_reports").select("group_id,status").in("group_id", pending).neq("status", "approved");
    if (reportError_) throw new Error(`보고서 조회 실패: ${reportError_.message}`);
    for (const r of reports ?? []) notApproved.add(String(r.group_id));
  }
  const today = kstToday();
  return rows.filter(g => g.status === "pending" ? !notApproved.has(g.id) : g.effective_date <= today).slice(0, 200).map(g => ({ id: g.id, tenantId: g.tenant_id }));
}

async function runRelease(db: Db, opts: { tenantId: string | null; documentId: string | null; actorId: string | null }, checks: Record<string, RefundCheck>): Promise<ReleaseResult> {
  const { data, error } = await db.rpc("release_withdrawal_report_refunds", { p_tenant: opts.tenantId, p_document: opts.documentId, p_actor: opts.actorId, p_checks: checks });
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
}

async function finishReleased(db: Db, row: Released, actorId: string | null) {
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
