import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";

// 운영 감사로그 액션 키 + 라벨 — logAction 호출부와 뷰어 필터가 공유.
export const AUDIT_ACTIONS = {
  staff_role_change: "역할 변경",
  staff_delete: "직원 삭제",
  invoice_create: "청구서 생성",
  exam_create: "시험 등록",
  exam_delete: "시험 삭제",
  exam_scores: "성적 일괄입력",
  payroll_upsert: "급여 정산",
  withdrawal_update: "퇴원 사유",
} as const;
export type AuditActionKey = keyof typeof AUDIT_ACTIONS;

export const auditActionLabel = (a: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[a] ?? a;

type LogArgs = {
  action: AuditActionKey | string;
  targetType?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * 고가치 mutation을 감사로그에 기록(INSERT-only). 서버 액션 본 작업 성공 후 호출.
 * RLS createClient라 tenant_id=actor.tenantId 행만 INSERT(정책 통과). best-effort: 실패해도 본 작업 안 막음.
 */
export async function logAction(args: LogArgs): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const supabase = await createClient();
    await supabase.from("audit_logs").insert({
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_name: user.displayName,
      action: args.action,
      target_type: args.targetType ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
  } catch {
    // 감사 기록 실패는 본 작업을 막지 않음
  }
}

export type AuditLogRow = {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export async function getAuditLogsPage(
  filter: { action?: string },
  page = 1,
  pageSize = 50,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("audit_logs")
    .select("id, actor_name, action, target_type, target_label, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (filter.action && filter.action !== "all") q = q.eq("action", filter.action);

  const { data, count } = await q;
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetLabel: r.target_label,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
  };
}
