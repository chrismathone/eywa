import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { logActionAs } from "@/features/audit/server/log";
import { reportError } from "@/lib/observability/report-error";
import { deliverDue } from "./deliver";
import { expandInbox } from "./expand";
import { loadConnection } from "./store";

/**
 * 슬랙 발송기 — 지점 하나를 한 번 돌린다(인박스 펼치기 → 보낼 것 보내기). 두 곳에서 부른다:
 *  · 앱에서 알림·활동이 생긴 요청의 **응답 뒤**(`pokeSlack`) — 앱에서 생긴 일은 수 초 안에 나간다
 *  · 1분 cron(`/api/cron/slack-dispatch`) — 워커·DB 트리거·스크립트가 넣은 것, 재시도, 요약 시각
 * 🔴 지점 리스(55초)로 동시에 둘이 돌지 않는다 — 못 잡으면 조용히 끝낸다(다른 실행이 처리 중).
 */
const LEASE_MS = 55_000;

export function appUrlOrNull(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

export async function drainTenant(tenantId: string): Promise<{ expanded: number; sent: number } | null> {
  const loaded = await loadConnection(tenantId);
  if (loaded.status !== "ok" || !loaded.value?.botToken || loaded.value.status !== "active") return null;
  if (!(await isFeatureOptedIn(tenantId, "slack"))) return null;
  const conn = loaded.value;

  const admin = createAdminClient();
  const now = new Date();
  const leaseId = crypto.randomUUID();
  const { data: leased } = await admin
    .from("slack_connections")
    .update({ lease_id: leaseId, lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("tenant_id", tenantId)
    .or(`lease_until.is.null,lease_until.lt."${now.toISOString()}"`) // 값에 . : 가 있어 따옴표로 감싼다
    .select("tenant_id");
  if (!leased?.length) return null;

  let expanded = 0;
  let sent = 0;
  let errorCode: string | null = null;
  try {
    expanded = await expandInbox(tenantId, conn, appUrlOrNull(), now);
    const res = await deliverDue(tenantId, conn.botToken, new Date());
    sent = res.sent;
    errorCode = res.authError;
  } catch (e) {
    reportError(e, { scope: "slack.drain", tenantId });
    errorCode = "drain_failed";
  } finally {
    await admin
      .from("slack_connections")
      .update({
        lease_until: null,
        last_dispatch_at: new Date().toISOString(),
        ...(errorCode ? { last_error_code: errorCode, last_error_at: new Date().toISOString() } : {}),
        // 토큰이 죽었으면 '끊김' — 매분 재시도하지 않고 화면에 알린다(원장이 새 토큰을 넣으면 active로 돌아온다).
        ...(errorCode && errorCode !== "drain_failed" ? { status: "broken" } : {}),
      })
      .eq("tenant_id", tenantId)
      .eq("lease_id", leaseId);
    // 사람이 아니라 발송기가 연결을 '끊김'으로 바꾼 것 — 감사로그에 시스템 행위자로 남긴다(원장 "감사로그도 잘 배선").
    if (errorCode && errorCode !== "drain_failed") {
      await logActionAs(
        { tenantId, actorName: "system:slack-dispatch" },
        { action: "slack_connection_broken", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { code: errorCode } },
      );
    }
  }
  return { expanded, sent };
}

/** cron — 연결된 지점 전부 + 오래된 기록 정리(인박스 처리분 7일 · 아웃박스 끝난 것 30일). */
export async function drainAll(): Promise<{ tenants: number; expanded: number; sent: number }> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("slack_connections").select("tenant_id").neq("bot_token", "").eq("status", "active");
  if (error) return { tenants: 0, expanded: 0, sent: 0 };
  let expanded = 0;
  let sent = 0;
  for (const row of data ?? []) {
    const r = await drainTenant(row.tenant_id as string).catch((e) => {
      reportError(e, { scope: "slack.drain_all", tenantId: row.tenant_id });
      return null;
    });
    expanded += r?.expanded ?? 0;
    sent += r?.sent ?? 0;
  }
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
  await admin.from("slack_inbox").delete().neq("status", "pending").lt("created_at", week);
  await admin.from("slack_outbox").delete().in("status", ["sent", "dead", "cancelled"]).lt("created_at", month);
  return { tenants: data?.length ?? 0, expanded, sent };
}
