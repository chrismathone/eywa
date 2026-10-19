import "server-only";
import { createAdminClient, createRawAdminClient } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/lib/auth/super-admin";

export type SuperAdminAction =
  | "create_tenant"
  | "update_tenant"
  | "impersonate_view"
  | "tenant_view_activity"
  | "grant_license"
  | "toggle_license"
  | "toggle_laboratory_menu"
  | "set_ai_model"
  | "change_user_role"
  | "reset_user_password"
  | "set_user_active"
  | "protected_account_refused"
  | "protected_integrity_alert"
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

/**
 * 위와 같은 기록인데 **남겼는지를 돌려준다** — 기록이 남아야만 진행해야 하는 일(지점 화면을 여는 것)이 쓴다.
 * 못 남겼으면 false(부르는 쪽이 그 일을 그만둔다).
 */
export async function recordSuperAdminAction(args: LogArgs): Promise<boolean> {
  try {
    const { error } = await createAdminClient().from("super_admin_audit_logs").insert({
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      action: args.action,
      target_tenant_id: args.targetTenantId ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
    return !error;
  } catch {
    return false;
  }
}

/**
 * '지점 보기'(읽기 전용) 중에 운영자가 한 **기록 대상 동작**(내려받기 · 민감 정보 열람 등)을 운영 감사 로그에 남긴다.
 *
 * 지점의 감사 로그(`audit_logs`)에는 적지 않는다 — 그 지점 사람이 한 일이 아니고, 보기 중에는 그 지점에 아무것도 쓰지 않는다.
 * 그렇다고 안 남기면 "운영자가 남의 지점 자료를 내려받았다"는 사실이 어디에도 없게 된다. 그래서 여기로 온다
 * ([`logAction`](../../audit/server/log.ts)이 보기 중이면 이 함수를 부른다).
 * 🔴 가드 없는 클라이언트를 쓴다 — 보기 중인 요청의 쓰기는 전부 막히는데(tenant-view-guard.ts), 이 한 줄은 지점 데이터가 아니라
 *    운영 기록이라 써져야 한다. best-effort: 실패해도 본 동작을 막지 않는다.
 */
export async function logTenantViewActivity(args: {
  actorId: string;
  actorEmail: string;
  tenantId: string;
  tenantName: string;
  action: string;
  actionLabel: string;
  targetType?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await createRawAdminClient().from("super_admin_audit_logs").insert({
      actor_id: args.actorId,
      actor_email: args.actorEmail,
      action: "tenant_view_activity" satisfies SuperAdminAction,
      target_tenant_id: args.tenantId,
      target_label: args.tenantName,
      metadata: {
        action: args.action,
        actionLabel: args.actionLabel,
        targetType: args.targetType ?? null,
        targetLabel: args.targetLabel ?? null,
        detail: args.metadata ?? null,
      },
    });
  } catch {
    // 기록 실패는 본 동작을 막지 않음
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
