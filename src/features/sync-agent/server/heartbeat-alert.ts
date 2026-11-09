import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { notifyUsers } from "@/features/notifications/server/notify";
import { deviceConfiguration } from "./control";
import {
  decideHeartbeatAlert,
  isAppAlive,
  isIntentionallyOff,
  heartbeatAlertBucket,
  heartbeatAlertText,
  HEARTBEAT_ALERT_LINK,
  latestRealHeartbeat,
  SYNC_AGENT_OFFLINE_TYPE,
  type HeartbeatDecision,
} from "../heartbeat-alert";

type Outcome = HeartbeatDecision | "disabled" | "no_recipient" | "already_alerted" | "error";
type DeviceRow = { id: string; tenant_id: string; status: unknown; last_seen_at: string | null; revoke_requested_at: string | null };

/**
 * 연동 PC 신호 끊김 점검(정기 작업 `/api/cron/sync-agent-heartbeat` · 10분마다) — 규칙은 `../heartbeat-alert.ts`.
 * 대상 = 연동 PC가 등록된(해제 안 된) 지점. **원장이 일부러 끈 경우는 알리지 않는다** — PC가 받는 설정과 같은 판정(`deviceConfiguration`:
 * 연동 실행·ClassNote 켜짐 ∧ 학원 ClassNote 모듈) + PC 앱 일시 중지 · ClassNote 꺼짐 · 연결 해제 요청 중.
 * 중복 방지 = `notification_events`(유일 제약 · 끊김 한 번 = 마지막 신호 시각) — 원장이 알림을 지워도 다시 울리지 않고, 겹친 실행도 한 번만.
 * 받는 사람 = 그 지점 재직 원장 전원(makeedu 로그인 실패 알림 `check-session.mjs`와 같은 선례). 지점마다 실패해도 다음 지점은 계속 본다.
 * 신호가 돌아오면 안 읽은 끊김 알림을 읽음으로 — 이미 풀린 끊김이 나중에 화면 중앙 팝업으로 뜨지 않게.
 * 쓰기는 알림·중복 방지 줄뿐(사람이 한 일이 아니라 감사로그 대상 아님).
 */
export async function checkSyncAgentHeartbeat(now = new Date()): Promise<{ tenantId: string; decision: Outcome; notified?: number }[]> {
  const db = createAdminClient();
  const { data: devices, error } = await db.from("sync_agent_devices").select("id, tenant_id, status, last_seen_at, revoke_requested_at").is("revoked_at", null);
  if (error) throw error;
  // 지점마다 기기 1대(부분 유일 색인) — 혹시 여럿이면 가장 최근에 신호를 보낸 기기.
  const byTenant = new Map<string, DeviceRow>();
  for (const d of (devices ?? []) as DeviceRow[]) {
    const prev = byTenant.get(String(d.tenant_id));
    if (!prev || Date.parse(String(d.last_seen_at ?? "")) > Date.parse(String(prev.last_seen_at ?? ""))) byTenant.set(String(d.tenant_id), d);
  }
  const out: { tenantId: string; decision: Outcome; notified?: number }[] = [];
  for (const [tenantId, device] of byTenant) {
    try {
      if (isIntentionallyOff(device, now)) {
        out.push({ tenantId, decision: "disabled" });
        continue;
      }
      const [config, workers] = await Promise.all([
        deviceConfiguration({ id: device.id, tenantId }),
        db.from("classnote_workers").select("last_seen, last_results").eq("tenant_id", tenantId),
      ]);
      if (!config.enabled || !config.classnoteEnabled) {
        out.push({ tenantId, decision: "disabled" });
        continue;
      }
      if (workers.error) throw workers.error;
      const lastSeen = latestRealHeartbeat(workers.data ?? []);
      const decision = decideHeartbeatAlert({ now, lastSeen });
      if (decision === "ok" && lastSeen) {
        const { error: rErr } = await db
          .from("notifications")
          .update({ read_at: now.toISOString() })
          .eq("tenant_id", tenantId)
          .eq("type", SYNC_AGENT_OFFLINE_TYPE)
          .is("read_at", null)
          .lt("created_at", lastSeen.toISOString());
        if (rErr) reportError(rErr, { scope: "sync-agent.heartbeat-alert.recovered", tenantId });
      }
      if (decision !== "alert" || !lastSeen) {
        out.push({ tenantId, decision });
        continue;
      }
      // 받는 사람 먼저 — 받을 사람이 없는데 중복 방지 줄만 남기면 원장이 생긴 뒤에도 그 끊김은 영영 안 온다(결석 알림과 같은 순서).
      const { data: masters, error: mErr } = await db.from("users").select("id").eq("tenant_id", tenantId).eq("status", "active").eq("system_role", "master");
      if (mErr) throw mErr;
      const recipients = (masters ?? []).map((m) => String(m.id));
      if (!recipients.length) {
        reportError(new Error("연동 PC 신호 끊김 — 알림을 받을 재직 원장이 없음"), { scope: "sync-agent.heartbeat-alert", tenantId });
        out.push({ tenantId, decision: "no_recipient" });
        continue;
      }
      const { data: fresh, error: dErr } = await db
        .from("notification_events")
        .upsert([{ tenant_id: tenantId, event_type: SYNC_AGENT_OFFLINE_TYPE, subject_key: "classnote_worker", bucket: heartbeatAlertBucket(lastSeen), seeded: false }], {
          onConflict: "tenant_id,event_type,subject_key,bucket",
          ignoreDuplicates: true,
        })
        .select("id");
      if (dErr) throw dErr;
      if (!fresh?.length) {
        out.push({ tenantId, decision: "already_alerted" });
        continue;
      }
      const text = heartbeatAlertText(lastSeen, now, { appAlive: isAppAlive(device.last_seen_at, now) });
      await notifyUsers(recipients.map((recipientId) => ({ tenantId, recipientId, type: SYNC_AGENT_OFFLINE_TYPE, title: text.title, body: text.body, link: HEARTBEAT_ALERT_LINK })));
      out.push({ tenantId, decision, notified: recipients.length });
    } catch (e) {
      reportError(e, { scope: "sync-agent.heartbeat-alert", tenantId });
      out.push({ tenantId, decision: "error" });
    }
  }
  return out;
}
