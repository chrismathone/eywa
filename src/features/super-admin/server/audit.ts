import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

export type SuperAdminAction =
  | "create_tenant"
  | "update_tenant"
  | "impersonate_view"
  | "grant_license"
  | "toggle_license"
  | "change_user_role"
  | "reset_user_password"
  | "set_user_active"
  | "protected_account_refused"
  | "support_request_answer"
  | "support_notice_create"
  | "support_notice_update"
  | "support_notice_delete";

type LogArgs = {
  actorId: string;
  actorEmail: string;
  action: SuperAdminAction;
  targetTenantId?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * super-admin 액션을 audit log에 기록 (INSERT-only).
 * service_role 클라이언트 사용 (RLS write 정책 없음 — service_role만 INSERT 가능).
 * best-effort: 기록 실패가 본 작업을 막지 않도록 swallow.
 */
export async function logSuperAdminAction(args: LogArgs): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("super_admin_audit_logs").insert({
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      action: args.action,
      target_tenant_id: args.targetTenantId ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
  } catch {
    // audit 기록 실패는 본 작업을 막지 않음
  }
}

export type AuditLogRow = {
  id: string;
  actorEmail: string;
  action: string;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export async function getAuditLogs(filter?: {
  action?: string;
  limit?: number;
}): Promise<AuditLogRow[]> {
  await requireSuperAdmin(); // 레이아웃 게이트에만 기대지 않는다(보안 감사 2026-09-29)
  const admin = createAdminClient();
  let q = admin
    .from("super_admin_audit_logs")
    .select("id, actor_email, action, target_label, metadata, created_at")
    .order("created_at", { ascending: false })
    .limit(filter?.limit ?? 100);
  if (filter?.action && filter.action !== "all") {
    q = q.eq("action", filter.action);
  }
  const { data } = await q;
  return (data ?? []).map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    targetLabel: r.target_label,
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.created_at,
  }));
}

/**
 * 감사 로그 서버 페이지네이션 — limit:200 하드캡 평면 렌더(초과분 무경고 소실)를 해소.
 * action 필터는 SQL eq, 전체는 .range + count:exact로 50행씩.
 */
export async function getAuditLogsPage(
  filter: { action?: string },
  page = 1,
  pageSize = 50,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  await requireSuperAdmin(); // 레이아웃 게이트에만 기대지 않는다(보안 감사 2026-09-29)
  const admin = createAdminClient();
  const from = (page - 1) * pageSize;
  let q = admin
    .from("super_admin_audit_logs")
    .select("id, actor_email, action, target_label, metadata, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (filter.action && filter.action !== "all") {
    q = q.eq("action", filter.action);
  }
  const { data, count } = await q;
  const rows = (data ?? []).map((r) => ({
    id: r.id,
    actorEmail: r.actor_email,
    action: r.action,
    targetLabel: r.target_label,
    metadata: r.metadata as Record<string, unknown> | null,
    createdAt: r.created_at,
  }));
  return { rows, total: count ?? rows.length };
}
