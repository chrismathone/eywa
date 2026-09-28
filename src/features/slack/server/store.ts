import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextKeySince, normalizeTime, sanitizeRule, type SlackRule } from "../rules";

/**
 * 슬랙 저장소 — 연결(0297a·0298a `slack_connections`) · 규칙(`slack_rules`) · 사람 연결(`slack_user_links`). 서버 전용.
 * 🔴 전부 service_role만 읽는 표(정책 0, 권한 회수) → **게이트를 통과한 호출부**만 부른다. 항상 `tenant_id`로 거른다.
 */
export const SLACK_TABLE_MISSING_MESSAGE = "슬랙 연동 표가 아직 DB에 없습니다(0297a·0298a 적용 필요)";

export type SlackConnection = {
  botToken: string;
  teamName: string;
  teamId: string;
  botUserId: string;
  status: "active" | "broken";
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  weekendQuiet: boolean;
  digestAt: string;
  lastDispatchAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
};
export type Load<T> = { status: "ok"; value: T } | { status: "missing_table" } | { status: "error" };

export function isMissingTable(err: { code?: string; message?: string }): boolean {
  const msg = err.message ?? "";
  return (
    err.code === "42P01" ||
    err.code === "PGRST205" ||
    err.code === "42703" || // 0298a 전: 새 칸이 없다
    (/slack_/.test(msg) && /schema cache|does not exist/.test(msg))
  );
}

const CONN_COLS =
  "bot_token, team_name, team_id, bot_user_id, status, dnd_enabled, dnd_start, dnd_end, weekend_quiet, digest_at, last_dispatch_at, last_error_code, last_error_at";

function toConnection(d: Record<string, unknown>): SlackConnection {
  return {
    botToken: (d.bot_token as string) ?? "",
    teamName: (d.team_name as string) ?? "",
    teamId: (d.team_id as string) ?? "",
    botUserId: (d.bot_user_id as string) ?? "",
    status: d.status === "broken" ? "broken" : "active",
    dndEnabled: d.dnd_enabled !== false,
    dndStart: normalizeTime(d.dnd_start) ?? "22:00",
    dndEnd: normalizeTime(d.dnd_end) ?? "08:00",
    weekendQuiet: d.weekend_quiet === true,
    digestAt: normalizeTime(d.digest_at) ?? "08:00",
    lastDispatchAt: (d.last_dispatch_at as string | null) ?? null,
    lastErrorCode: (d.last_error_code as string | null) ?? null,
    lastErrorAt: (d.last_error_at as string | null) ?? null,
  };
}

export async function loadConnection(tenantId: string): Promise<Load<SlackConnection | null>> {
  try {
    const { data, error } = await createAdminClient()
      .from("slack_connections")
      .select(CONN_COLS)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error) return isMissingTable(error) ? { status: "missing_table" } : { status: "error" };
    return { status: "ok", value: data ? toConnection(data as Record<string, unknown>) : null };
  } catch {
    return { status: "error" };
  }
}

export async function saveConnection(
  tenantId: string,
  userId: string | null,
  patch: Record<string, string | boolean | null>,
): Promise<{ error?: string }> {
  const { error } = await createAdminClient()
    .from("slack_connections")
    .upsert({ tenant_id: tenantId, ...patch, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  if (!error) return {};
  return { error: isMissingTable(error) ? SLACK_TABLE_MISSING_MESSAGE : "슬랙 설정을 저장하지 못했습니다" };
}

// ── 규칙 ────────────────────────────────────────────────────────────────
const RULE_COLS =
  "id, name, enabled, source, type_keys, targets, template, mention_recipients, ping, exclude_actor_ids, timing, digest_at, honor_dnd, version";

export function ruleFromRow(d: Record<string, unknown>, activityKeys: ReadonlySet<string>): SlackRule | null {
  return sanitizeRule(
    {
      id: d.id,
      name: d.name,
      enabled: d.enabled,
      source: d.source,
      typeKeys: d.type_keys,
      targets: d.targets,
      template: d.template,
      mentionRecipients: d.mention_recipients,
      ping: d.ping,
      excludeActorIds: d.exclude_actor_ids,
      timing: d.timing,
      digestAt: d.digest_at,
      honorDnd: d.honor_dnd,
      version: d.version,
    },
    activityKeys,
  );
}

export async function loadRules(tenantId: string, activityKeys: ReadonlySet<string>): Promise<Load<SlackRule[]>> {
  const { data, error } = await createAdminClient()
    .from("slack_rules")
    .select(RULE_COLS)
    .eq("tenant_id", tenantId)
    .order("sort_order")
    .order("created_at");
  if (error) return isMissingTable(error) ? { status: "missing_table" } : { status: "error" };
  const rules = (data ?? [])
    .map((d) => ruleFromRow(d as Record<string, unknown>, activityKeys))
    .filter((r): r is SlackRule => !!r);
  return { status: "ok", value: rules };
}

function ruleToRow(rule: SlackRule) {
  return {
    name: rule.name,
    enabled: rule.enabled,
    source: rule.source,
    type_keys: rule.typeKeys,
    targets: rule.targets,
    template: rule.template,
    mention_recipients: rule.mentionRecipients,
    ping: rule.ping,
    exclude_actor_ids: rule.excludeActorIds,
    timing: rule.timing,
    digest_at: rule.digestAt,
    honor_dnd: rule.honorDnd,
  };
}

/** 새 규칙이면 만들고, 있으면 `version`이 같을 때만 고친다(동시 편집 충돌 = 다른 사람이 먼저 저장). */
export async function upsertRule(
  tenantId: string,
  userId: string,
  rule: SlackRule,
): Promise<{ id?: string; version?: number; error?: string; conflict?: boolean }> {
  const admin = createAdminClient();
  const now = new Date().toISOString();
  // 0300a 전이면 key_since 칸이 없다 — 그땐 빼고 저장한다(규칙 저장이 SQL 순서에 묶이지 않게, [[#95]]).
  const { data: prevRow, error: prevErr } = rule.id
    ? await admin.from("slack_rules").select("key_since, enabled").eq("tenant_id", tenantId).eq("id", rule.id).maybeSingle()
    : await admin.from("slack_rules").select("key_since").eq("tenant_id", tenantId).limit(1).maybeSingle();
  const hasKeySince = !prevErr;
  const prev = rule.id ? (prevRow as { key_since?: Record<string, string>; enabled?: boolean } | null) : null;
  const keySince = hasKeySince
    ? { key_since: nextKeySince(prev ? { since: prev.key_since ?? {}, enabled: prev.enabled === true } : null, rule, now) }
    : {};
  if (!rule.id) {
    const { data, error } = await admin
      .from("slack_rules")
      .insert({ tenant_id: tenantId, ...ruleToRow(rule), ...keySince, updated_by: userId, updated_at: now })
      .select("id, version")
      .single();
    if (error) return { error: isMissingTable(error) ? SLACK_TABLE_MISSING_MESSAGE : "규칙을 저장하지 못했습니다" };
    return { id: data.id as string, version: data.version as number };
  }
  const { data, error } = await admin
    .from("slack_rules")
    .update({ ...ruleToRow(rule), ...keySince, version: rule.version + 1, updated_by: userId, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("id", rule.id)
    .eq("version", rule.version)
    .select("id, version");
  if (error) return { error: "규칙을 저장하지 못했습니다" };
  if (!data || data.length === 0) return { conflict: true, error: "다른 사람이 먼저 이 규칙을 고쳤습니다 — 새로고침한 뒤 다시 저장해 주세요" };
  return { id: data[0].id as string, version: data[0].version as number };
}

export async function deleteRule(tenantId: string, ruleId: string): Promise<{ error?: string }> {
  const admin = createAdminClient();
  // 대기 중인 발송은 취소한다(규칙이 지워졌는데 요약이 나가면 혼란).
  await admin.from("slack_outbox").update({ status: "cancelled" }).eq("tenant_id", tenantId).eq("rule_id", ruleId).eq("status", "pending");
  const { error } = await admin.from("slack_rules").delete().eq("tenant_id", tenantId).eq("id", ruleId);
  return error ? { error: "규칙을 지우지 못했습니다" } : {};
}

// ── 사람 연결 ─────────────────────────────────────────────────────────────
export type SlackLink = { aywaUserId: string; slackUserId: string; method: "code" | "owner_email" };

export async function loadLinks(tenantId: string): Promise<Map<string, SlackLink>> {
  const { data, error } = await createAdminClient()
    .from("slack_user_links")
    .select("aywa_user_id, slack_user_id, method")
    .eq("tenant_id", tenantId);
  if (error) return new Map();
  return new Map(
    (data ?? []).map((d) => [
      d.aywa_user_id as string,
      { aywaUserId: d.aywa_user_id as string, slackUserId: d.slack_user_id as string, method: d.method as SlackLink["method"] },
    ]),
  );
}
