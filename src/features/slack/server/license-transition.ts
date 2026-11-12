import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";

export const SLACK_LICENSE_CLOSE_REASON = "지점 슬랙 꺼짐";

export type SlackLicenseTransition = "enable" | "disable" | "unchanged";
export type SlackPendingClose = { inboxSkipped: number; outboxCancelled: number; error?: string };
export type SlackMaintenanceLease = { leaseId: string | null; error?: string };

const MAINTENANCE_LEASE_MS = 90_000;

export function slackLicenseTransition(previousOn: boolean, nextOn: boolean): SlackLicenseTransition {
  if (previousOn === nextOn) return "unchanged";
  return nextOn ? "enable" : "disable";
}

export function keySinceAt(typeKeys: readonly string[], now: string): Record<string, string> {
  return Object.fromEntries(typeKeys.map((key) => [key, now]));
}

/** 다시 켜는 동안 기존 발송기가 유실 대조·펼치기를 끼워 넣지 못하게 지점 리스를 잡는다. 연결 전이면 잡을 행이 없어도 안전하다. */
export async function acquireSlackMaintenanceLease(tenantId: string, now: Date): Promise<SlackMaintenanceLease> {
  const admin = createAdminClient();
  const current = await admin
    .from("slack_connections")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (current.error) return { leaseId: null, error: "슬랙 연결 상태를 확인하지 못했습니다" };
  if (!current.data) return { leaseId: null };

  const leaseId = crypto.randomUUID();
  const nowIso = now.toISOString();
  const leased = await admin
    .from("slack_connections")
    .update({ lease_id: leaseId, lease_until: new Date(now.getTime() + MAINTENANCE_LEASE_MS).toISOString() })
    .eq("tenant_id", tenantId)
    .or(`lease_until.is.null,lease_until.lt."${nowIso}"`)
    .select("tenant_id");
  if (leased.error) return { leaseId: null, error: "슬랙 발송 잠금을 잡지 못했습니다" };
  if (!leased.data?.length) return { leaseId: null, error: "슬랙 발송 정리가 진행 중입니다 — 잠시 후 다시 시도해 주세요" };
  return { leaseId };
}

export async function releaseSlackMaintenanceLease(tenantId: string, leaseId: string | null): Promise<void> {
  if (!leaseId) return;
  await createAdminClient()
    .from("slack_connections")
    .update({ lease_id: null, lease_until: null })
    .eq("tenant_id", tenantId)
    .eq("lease_id", leaseId);
}

/** 스위치를 끄거나 다시 켜기 전에, 그 전 켜짐 구간에서 남은 대기를 끝낸다. */
export async function closePendingSlackWork(tenantId: string, now: string): Promise<SlackPendingClose> {
  const admin = createAdminClient();
  const result: SlackPendingClose = { inboxSkipped: 0, outboxCancelled: 0 };
  const inbox = await admin
    .from("slack_inbox")
    .update({ status: "skipped", processed_at: now }, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  result.inboxSkipped = inbox.count ?? 0;
  if (inbox.error) return { ...result, error: "슬랙 인박스 대기를 정리하지 못했습니다" };

  const outbox = await admin
    .from("slack_outbox")
    .update({ status: "cancelled", last_error_code: SLACK_LICENSE_CLOSE_REASON }, { count: "exact" })
    .eq("tenant_id", tenantId)
    .eq("status", "pending");
  result.outboxCancelled = outbox.count ?? 0;
  if (outbox.error) return { ...result, error: "슬랙 발송 대기를 정리하지 못했습니다" };
  return result;
}

type RuleCursorRow = { id: string; type_keys: string[] | null; version: number; enabled: boolean };

/**
 * 다시 켜는 시각을 켜진 규칙 전부의 유실 대조 하한으로 삼는다.
 * `version`도 함께 올린다. 이 변경을 모르고 열린 규칙 편집 화면은 저장이 거절되어, 옛 `key_since`로 되돌리지 못한다.
 */
export async function resetEnabledRuleWindows(tenantId: string, now: string): Promise<{ rulesReset: number; error?: string }> {
  const admin = createAdminClient();
  let rows: RuleCursorRow[];
  try {
    rows = await fetchAllPaged<RuleCursorRow>((from, to) =>
      admin
        .from("slack_rules")
        .select("id, type_keys, version, enabled")
        .eq("tenant_id", tenantId)
        .eq("enabled", true)
        .order("id")
        .range(from, to),
    );
  } catch {
    return { rulesReset: 0, error: "슬랙 규칙의 시작 시각을 읽지 못했습니다" };
  }

  const resets = await Promise.all(rows.map((row) => resetOneRule(tenantId, row, now)));
  const rulesReset = resets.reduce((sum, reset) => sum + reset.changed, 0);
  const error = resets.find((reset) => reset.error)?.error;
  return error ? { rulesReset, error } : { rulesReset };
}

async function resetOneRule(
  tenantId: string,
  initial: RuleCursorRow,
  now: string,
): Promise<{ changed: number; error?: string }> {
  const admin = createAdminClient();
  let row: RuleCursorRow | null = initial;
  for (let attempt = 0; attempt < 3 && row?.enabled; attempt++) {
    const { data, error } = await admin
      .from("slack_rules")
      .update({ key_since: keySinceAt(row.type_keys ?? [], now), version: row.version + 1, updated_at: now })
      .eq("tenant_id", tenantId)
      .eq("id", row.id)
      .eq("enabled", true)
      .eq("version", row.version)
      .select("id");
    if (error) return { changed: 0, error: "슬랙 규칙의 시작 시각을 저장하지 못했습니다" };
    if (data?.length) return { changed: 1 };

    const latest: { data: unknown; error: unknown } = await admin
      .from("slack_rules")
      .select("id, type_keys, version, enabled")
      .eq("tenant_id", tenantId)
      .eq("id", row.id)
      .maybeSingle();
    if (latest.error) return { changed: 0, error: "동시에 바뀐 슬랙 규칙을 다시 읽지 못했습니다" };
    row = (latest.data as RuleCursorRow | null) ?? null;
  }
  if (!row || !row.enabled) return { changed: 0 };
  return { changed: 0, error: "슬랙 규칙이 동시에 계속 바뀌어 시작 시각을 저장하지 못했습니다" };
}
