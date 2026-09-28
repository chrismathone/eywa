import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isFeatureOptedIn } from "@/lib/license/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ActivityOption } from "../activity-catalog";
import { maskSlackToken } from "../format";
import type { SlackRule } from "../rules";
import { activityKeySet, activityOptions } from "./catalog";
import { slackGate } from "./gate";
import { loadConnection, loadLinks, loadRules } from "./store";

/**
 * 슬랙 카드 상태. 🔴 토큰 원문은 절대 내려보내지 않는다(가린 값만).
 *  · off = 슈퍼관리자 스위치가 꺼짐 → 카드를 세우지 않는다 · readonly = 원장·총괄이 아님 → 안내만
 * 상태 숫자는 **건수만 센다**(행을 끌어오지 않는다, B2).
 */
export type SlackHealth = { pending: number; failedDay: number; notLinkedDay: number };
export type SlackCardReady = {
  kind: "ready";
  connected: boolean;
  maskedToken: string;
  teamName: string;
  broken: boolean;
  lastDispatchAt: string | null;
  lastErrorCode: string | null;
  schedule: { dndEnabled: boolean; dndStart: string; dndEnd: string; weekendQuiet: boolean; digestAt: string };
  rules: SlackRule[];
  activityOptions: ActivityOption[];
  staff: { id: string; name: string }[];
  health: SlackHealth;
};
export type SlackCardState = { kind: "off" } | { kind: "readonly" } | { kind: "missing_table" } | { kind: "error" } | SlackCardReady;

export async function getSlackCardState(): Promise<SlackCardState> {
  const user = await getCurrentUser();
  if (!user || !(await isFeatureOptedIn(user.tenantId, "slack"))) return { kind: "off" };
  const g = await slackGate();
  if ("error" in g) return { kind: "readonly" };
  const [conn, rules, staff, health] = await Promise.all([
    loadConnection(g.tenantId),
    loadRules(g.tenantId, activityKeySet()),
    staffOptions(g.tenantId),
    healthOf(g.tenantId),
  ]);
  if (conn.status === "missing_table" || rules.status === "missing_table") return { kind: "missing_table" };
  if (conn.status !== "ok" || rules.status !== "ok") return { kind: "error" };
  const c = conn.value;
  return {
    kind: "ready",
    connected: !!c?.botToken,
    maskedToken: c?.botToken ? maskSlackToken(c.botToken) : "",
    teamName: c?.teamName ?? "",
    broken: c?.status === "broken",
    lastDispatchAt: c?.lastDispatchAt ?? null,
    lastErrorCode: c?.lastErrorCode ?? null,
    schedule: {
      dndEnabled: c?.dndEnabled ?? true,
      dndStart: c?.dndStart ?? "22:00",
      dndEnd: c?.dndEnd ?? "08:00",
      weekendQuiet: c?.weekendQuiet ?? false,
      digestAt: c?.digestAt ?? "08:00",
    },
    rules: rules.value,
    activityOptions: activityOptions(),
    staff,
    health,
  };
}

async function staffOptions(tenantId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await createAdminClient()
    .from("users")
    .select("id, display_name")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .neq("system_role", "student")
    .order("display_name")
    .limit(500);
  return (data ?? []).map((u) => ({ id: u.id as string, name: u.display_name as string }));
}

async function healthOf(tenantId: string): Promise<SlackHealth> {
  const admin = createAdminClient();
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const count = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then((r) => r.count ?? 0).catch(() => 0);
  const base = () => admin.from("slack_outbox").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const [pending, failedDay, notLinkedDay] = await Promise.all([
    count(base().eq("status", "pending")),
    count(base().eq("status", "dead").neq("last_error_code", "not_linked").gte("created_at", day)),
    count(base().eq("status", "dead").eq("last_error_code", "not_linked").gte("created_at", day)),
  ]);
  return { pending, failedDay, notLinkedDay };
}

/** '내 정보' 슬랙 카드 — 스위치가 꺼졌거나 학원 슬랙이 연결 전이면 null(카드를 안 세운다). */
export async function getMySlackState(): Promise<{ linked: "code" | "owner_email" | null; email: string } | null> {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student" || !(await isFeatureOptedIn(user.tenantId, "slack"))) return null;
  const conn = await loadConnection(user.tenantId);
  if (conn.status !== "ok" || !conn.value?.botToken) return null;
  const links = await loadLinks(user.tenantId);
  return { linked: links.get(user.id)?.method ?? null, email: user.email ?? "" };
}
