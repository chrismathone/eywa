import "server-only";
import { reportError } from "@/lib/observability/report-error";
import { agentContext, missingAgentSchema } from "./access";
import type { AgentCase, CaseEvent, CaseStatus } from "../model";
import { managementNotionConfig } from "./notion";
import { caseLabels } from "./labels";

export const CASE_COLUMNS = "id,tenant_id,consultation_id,student_id,assignee_id,source_counselor_id,source_due_on,source_done,status,episode,version,result_kind,result_note,verification_note,acknowledged_at,next_check_on,last_checked_at,created_at,updated_at,ai_advice,ai_version";
export const QUEUE_ERROR = "후속조치 기록을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.";

export async function consultationCase(consultationId: string, byCaseId = false) {
  const ctx = await agentContext();
  if (!ctx) return null;
  const { data, error } = await ctx.db.from("management_cases").select(CASE_COLUMNS)
    .eq("tenant_id", ctx.user.tenantId).eq(byCaseId ? "id" : "consultation_id", consultationId).maybeSingle();
  if (missingAgentSchema(error)) return { error: "후속조치 관리 기능을 준비 중입니다." };
  if (error) { reportError(error, { scope: "management-agent.case" }); return { error: QUEUE_ERROR }; }
  if (!data) return byCaseId ? { error: "기록이 없거나 열람 권한이 없습니다." } : { empty: true, manager: ctx.manager };
  const row = data as AgentCase;
  const events = await ctx.db.from("management_case_events").select("id,kind,note,created_at")
    .eq("tenant_id", ctx.user.tenantId).eq("case_id", row.id).order("created_at", { ascending: false }).limit(20);
  if (events.error) { reportError(events.error, { scope: "management-agent.timeline" }); return { error: QUEUE_ERROR }; }
  const [labeled] = await caseLabels(ctx.db,ctx.user.tenantId,[row]);
  return { row: labeled!, events: events.data as CaseEvent[], manager: ctx.manager,
    writable: ctx.level === "full" || ctx.level === "scoped", mode: ctx.policy.mode };
}

export async function managementQueue(page = 1) {
  const ctx = await agentContext();
  if (!ctx?.manager) return null;
  const states: CaseStatus[] = ["open", "in_progress", "waiting_review", "blocked"];
  const from = (Math.max(1, Math.min(10000, Math.trunc(page))) - 1) * 12;
  const [rows, resolved, notices, ...counts] = await Promise.all([
    ctx.db.from("management_cases").select(CASE_COLUMNS).eq("tenant_id", ctx.user.tenantId)
      .in("status", states).order("source_due_on").order("id").range(from, from + 12),
    ctx.db.from("management_cases").select(CASE_COLUMNS).eq("tenant_id", ctx.user.tenantId)
      .in("status", ["resolved", "dismissed"]).order("updated_at", { ascending: false }).limit(3),
    ctx.db.from("management_notion_outbox").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.user.tenantId).in("status", ["uncertain", "failed"]),
    ...states.map((status) => ctx.db.from("management_cases").select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.user.tenantId).eq("status", status)),
  ]);
  const error = rows.error ?? resolved.error ?? notices.error ?? counts.find((r) => r.error)?.error;
  if (error) {
    if (!missingAgentSchema(error)) reportError(error, { scope: "management-agent.queue" });
    return { error: missingAgentSchema(error) ? "후속조치 관리 기능을 준비 중입니다." : QUEUE_ERROR };
  }
  const notionMessage = ctx.policy.notionAlerts && !managementNotionConfig(ctx.user.tenantId)
    ? "노션 알림 연결 설정이 필요합니다. 에이와의 업무 기록은 유지됩니다."
    : notices.count ? `노션 알림 ${notices.count}건의 전달 확인이 필요합니다. 업무 접수 여부와는 별개입니다.` : null;
  return { rows: await caseLabels(ctx.db,ctx.user.tenantId,(rows.data as AgentCase[]).slice(0,12)), hasNext: (rows.data?.length ?? 0) > 12,
    resolved: resolved.data as AgentCase[], notionMessage,
    counts: Object.fromEntries(states.map((s,i) => [s,counts[i]!.count ?? 0])), mode: ctx.policy.mode };
}
