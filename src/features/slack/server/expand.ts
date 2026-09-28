import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { activityGradeOf } from "../activity-catalog";
import { renderActivity, renderNotification, type Rendered } from "../render";
import type { SlackRule } from "../rules";
import { planDelivery } from "../schedule";
import { activityKeySet, activityLabel } from "./catalog";
import { loadLinks, loadRules, type SlackConnection, type SlackLink } from "./store";

/**
 * 인박스 → 아웃박스 펼치기. 인박스(0298a 트리거가 같은 트랜잭션에서 넣은 id)를 집어 원본을 읽고,
 * 켜진 규칙마다 · 대상마다 발송 한 줄을 만든다. `dedupe_key`가 UNIQUE라 다시 펼쳐도 두 번 나가지 않는다.
 * 알림은 받는 사람마다 한 행이라, 같은 알림(종류·제목·본문·링크·생성 시각)을 **한 사건으로 묶어** 채널엔 한 통만 보낸다.
 */
const BATCH = 300;
type Outbox = Record<string, unknown>;
type NotifRow = { id: string; type: string; title: string; body: string | null; link: string | null; recipient_id: string; actor_id: string | null; created_at: string };
type AuditRow = { id: string; action: string; actor_id: string | null; actor_name: string | null; target_label: string | null; created_at: string };

export async function expandInbox(tenantId: string, conn: SlackConnection, appUrl: string | null, now: Date): Promise<number> {
  const admin = createAdminClient();
  const { data: inbox, error } = await admin
    .from("slack_inbox")
    .select("id, source, source_id")
    .eq("tenant_id", tenantId)
    .eq("status", "pending")
    .order("id")
    .limit(BATCH);
  if (error || !inbox || inbox.length === 0) return 0;

  const inboxBySource = new Map(inbox.map((r) => [`${r.source}:${r.source_id}`, r.id as number]));
  const idsOf = (s: string) => inbox.filter((r) => r.source === s).map((r) => r.source_id as string);
  const keys = activityKeySet();
  const [notifs, audits, rulesLoad, links] = await Promise.all([
    fetchInChunks<NotifRow>(idsOf("notification"), (c) =>
      admin.from("notifications").select("id, type, title, body, link, recipient_id, actor_id, created_at").eq("tenant_id", tenantId).in("id", c),
    ),
    fetchInChunks<AuditRow>(idsOf("activity"), (c) =>
      admin.from("audit_logs").select("id, action, actor_id, actor_name, target_label, created_at").eq("tenant_id", tenantId).in("id", c),
    ),
    loadRules(tenantId, keys),
    loadLinks(tenantId),
  ]);
  const rules = rulesLoad.status === "ok" ? rulesLoad.value.filter((r) => r.enabled && r.targets.length > 0) : [];
  const names = await recipientNames(tenantId, [...new Set(notifs.map((n) => n.recipient_id))]);

  const rows: Outbox[] = [];
  const push = (rule: SlackRule, dedupe: string, inboxId: number | undefined, target: object, r: Rendered, at: string, dead?: string) => {
    const d = planDelivery(now, rule, conn);
    rows.push({
      tenant_id: tenantId,
      rule_id: rule.id,
      inbox_id: inboxId ?? null,
      dedupe_key: dedupe,
      // quiet = 이 규칙은 방해금지를 지킨다 — 보내는 순간에도 다시 본다(deliver).
      target: { ...target, ping: rule.ping, quiet: rule.honorDnd && rule.timing === "immediate" },
      kind: d.kind,
      body: r.body,
      group_label: r.groupLabel,
      due_at: d.dueAt.toISOString(),
      created_at: at,
      ...(dead ? { status: "dead", last_error_code: dead } : {}),
    });
  };

  // 알림: 같은 사건(한 번의 insert 문 = 같은 created_at)끼리 묶는다.
  const groups = new Map<string, NotifRow[]>();
  for (const n of notifs) {
    const k = [n.type, n.title, n.body ?? "", n.link ?? "", n.created_at].join("\u0000");
    groups.set(k, [...(groups.get(k) ?? []), n]);
  }
  for (const group of groups.values()) {
    const head = [...group].sort((a, b) => a.id.localeCompare(b.id))[0];
    const ev = { type: head.type, title: head.title, body: head.body, link: head.link, createdAt: new Date(head.created_at) };
    for (const rule of rules) {
      if (rule.source !== "notification" || !rule.typeKeys.includes(head.type)) continue;
      if (head.actor_id && rule.excludeActorIds.includes(head.actor_id)) continue;
      const style = { template: rule.template, appUrl, ping: rule.ping };
      const inboxId = inboxBySource.get(`notification:${head.id}`);
      for (const t of rule.targets) {
        if (t.kind === "channel") {
          const who = group.map((n) =>
            rule.mentionRecipients && links.get(n.recipient_id) ? `<@${links.get(n.recipient_id)!.slackUserId}>` : names.get(n.recipient_id) ?? "",
          );
          const shown = rule.mentionRecipients || rule.template === "detailed" ? who.filter(Boolean) : [];
          push(rule, `n:${head.id}|${rule.id}|c:${t.channelId}`, inboxId, { kind: "channel", channelId: t.channelId }, renderNotification(ev, style, shown), head.created_at);
        } else if (t.kind === "recipient_dm") {
          for (const n of group) {
            pushDm(push, rule, `n:${n.id}|${rule.id}|r`, inboxBySource.get(`notification:${n.id}`), links, n.recipient_id, renderNotification(ev, style), n.created_at);
          }
        } else {
          pushDm(push, rule, `n:${head.id}|${rule.id}|u:${t.userId}`, inboxId, links, t.userId, renderNotification(ev, style), head.created_at);
        }
      }
    }
  }

  // 활동: 한 행 = 한 사건. 등급을 다시 확인한다(규칙 저장 뒤 분류가 바뀌었을 수 있다).
  for (const a of audits) {
    const grade = activityGradeOf(a.action);
    if (grade === "forbid" || !keys.has(a.action)) continue;
    const ev = { label: activityLabel(a.action), opaque: grade === "opaque", targetLabel: a.target_label, actorName: a.actor_name, createdAt: new Date(a.created_at) };
    for (const rule of rules) {
      if (rule.source !== "activity" || !rule.typeKeys.includes(a.action)) continue;
      if (a.actor_id && rule.excludeActorIds.includes(a.actor_id)) continue;
      const rendered = renderActivity(ev, { template: rule.template, appUrl, ping: rule.ping });
      const inboxId = inboxBySource.get(`activity:${a.id}`);
      for (const t of rule.targets) {
        if (t.kind === "channel") push(rule, `a:${a.id}|${rule.id}|c:${t.channelId}`, inboxId, { kind: "channel", channelId: t.channelId }, rendered, a.created_at);
        else if (t.kind === "user_dm") pushDm(push, rule, `a:${a.id}|${rule.id}|u:${t.userId}`, inboxId, links, t.userId, rendered, a.created_at);
      }
    }
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error: upErr } = await admin.from("slack_outbox").upsert(rows.slice(i, i + 200), { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (upErr) throw new Error(`slack outbox upsert: ${upErr.message}`); // 인박스를 처리됨으로 넘기지 않는다 → 다음 실행이 다시 펼친다
  }
  const ids = inbox.map((r) => r.id as number);
  for (let i = 0; i < ids.length; i += 100) {
    await admin.from("slack_inbox").update({ status: "processed", processed_at: now.toISOString() }).eq("tenant_id", tenantId).in("id", ids.slice(i, i + 100));
  }
  return inbox.length;
}

/**
 * 1:1 — 연결 안 된 사람은 보내지 않고 '연결 안 됨'으로 남긴다(화면 상태에 드러난다).
 * 대상에 **aywa 사용자 id**도 적는다 — 보내는 순간 연결을 다시 확인해(deliver), 그 사이 해제·변경된 연결로 옛 사람에게 가지 않게(codex 2차).
 */
function pushDm(
  push: (rule: SlackRule, dedupe: string, inboxId: number | undefined, target: object, r: Rendered, at: string, dead?: string) => void,
  rule: SlackRule,
  dedupe: string,
  inboxId: number | undefined,
  links: Map<string, SlackLink>,
  aywaUserId: string,
  rendered: Rendered,
  at: string,
) {
  const link = links.get(aywaUserId);
  if (link) push(rule, dedupe, inboxId, { kind: "dm", slackUserId: link.slackUserId, aywaUserId }, rendered, at);
  else push(rule, dedupe, inboxId, { kind: "dm", slackUserId: "", aywaUserId }, rendered, at, "not_linked");
}

async function recipientNames(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const admin = createAdminClient();
  const data = await fetchInChunks<{ id: string; display_name: string }>(ids, (c) =>
    admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", c),
  );
  return new Map(data.map((u) => [u.id, u.display_name]));
}

