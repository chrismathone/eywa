import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isFeatureOptedIn } from "@/lib/license/server";
import { logActionAs } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { describeSlackError } from "../format";
import { reportError } from "@/lib/observability/report-error";
import { deliverDue } from "./deliver";
import { expandInbox } from "./expand";
import { reconcileInbox } from "./reconcile";
import { loadConnection } from "./store";
import { acquireSlackMaintenanceLease, releaseSlackMaintenanceLease } from "./license-transition";

/**
 * 슬랙 발송기 — 지점 하나를 한 번 돌린다(인박스 펼치기 → 보낼 것 보내기). 두 곳에서 부른다:
 *  · 앱에서 알림·활동이 생긴 요청의 **응답 뒤**(`pokeSlack`) — 앱에서 생긴 일은 수 초 안에 나간다
 *  · 1분 cron(`/api/cron/slack-dispatch`) — 워커·DB 트리거·스크립트가 넣은 것, 재시도, 요약 시각
 * 🔴 지점 리스(90초)로 동시에 둘이 돌지 않는다 — 못 잡으면 조용히 끝낸다(다른 실행이 처리 중).
 *    발송은 `SEND_BUDGET_MS`(40초)까지만 — 한 실행이 리스보다 오래 가서 다음 실행과 겹치는 일이 없게(codex 2차).
 * cron 실행은 5분마다 유실 대조(`reconcileInbox`)도 한다 — 트리거가 삼킨 예외로 인박스에 못 들어간 사건 복구.
 */
const LEASE_MS = 90_000;
const SEND_BUDGET_MS = 40_000;

export function appUrlOrNull(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

export async function drainTenant(tenantId: string, opts: { reconcile?: boolean } = {}): Promise<{ expanded: number; sent: number } | null> {
  const loaded = await loadConnection(tenantId);
  if (loaded.status !== "ok" || !loaded.value?.botToken) return null;
  if (!(await isFeatureOptedIn(tenantId, "slack"))) return null;
  if (loaded.value.status !== "active") {
    // 끊긴 동안에도 유실 대조는 하되, 켜기 정리가 잡은 리스와 겹치지 않는다. 리스를 못 잡으면 다음 cron에 맡긴다.
    if (opts.reconcile) {
      const now = new Date();
      const lease = await acquireSlackMaintenanceLease(tenantId, now).catch((e) => {
        reportError(e, { scope: "slack.reconcile_broken_lease", tenantId });
        return { leaseId: null };
      });
      if (lease.leaseId) {
        try {
          await reconcileInbox(tenantId, now);
        } catch (e) {
          reportError(e, { scope: "slack.reconcile_broken", tenantId });
        } finally {
          await releaseSlackMaintenanceLease(tenantId, lease.leaseId).catch((e) =>
            reportError(e, { scope: "slack.reconcile_broken_release", tenantId }),
          );
        }
      }
    }
    return null;
  }
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
    if (opts.reconcile) await reconcileInbox(tenantId, now);
    expanded = await expandInbox(tenantId, conn, appUrlOrNull(), now);
    const res = await deliverDue(tenantId, conn.botToken, new Date(), now.getTime() + SEND_BUDGET_MS, conn);
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
      await notifyMasters(tenantId, errorCode);
    }
  }
  return { expanded, sent };
}

/** 끊김을 원장 알림(벨)으로도 — 슬랙만 보고 있으면 빠지고 있는 줄 모른다(grok 2차). 발송기는 멈춰 있으니 슬랙으로는 안 간다. */
async function notifyMasters(tenantId: string, code: string) {
  const { data } = await createAdminClient()
    .from("users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("system_role", "master")
    .eq("status", "active");
  await notifyUsers(
    (data ?? []).map((u) => ({
      tenantId,
      recipientId: u.id as string,
      type: "slack_broken" as const,
      title: "슬랙 발송이 멈췄습니다",
      body: `${describeSlackError(code)} 그동안의 알림은 쌓아 두었다가 새 토큰을 저장하면 이어서 보냅니다.`,
      link: "/owner?tab=sheets",
    })),
  );
}

/** cron — 연결된 지점 전부 + 오래된 기록 정리(인박스 처리분 7일 · 아웃박스 끝난 것 30일). */
export async function drainAll(): Promise<{ tenants: number; expanded: number; sent: number }> {
  const admin = createAdminClient();
  // 끊긴(broken) 지점도 돈다 — drainTenant가 발송은 건너뛰고 유실 대조만 한다.
  const { data, error } = await admin.from("slack_connections").select("tenant_id").neq("bot_token", "");
  if (error) return { tenants: 0, expanded: 0, sent: 0 };
  let expanded = 0;
  let sent = 0;
  for (const row of data ?? []) {
    // 유실 대조는 5분마다(매분 돌 필요는 없다 — 원본 두 표를 30분 창으로 읽는다).
    const r = await drainTenant(row.tenant_id as string, { reconcile: new Date().getUTCMinutes() % 5 === 0 }).catch((e) => {
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
