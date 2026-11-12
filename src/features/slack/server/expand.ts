import "server-only";
import { moneyFacts } from "../money-facts";
import { auditDetail } from "@/features/audit/describe";
import { activityChange } from "../activity-change";
import { contentLine } from "../activity-detail";
import type { ActivityFacts } from "../activity-facts";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeatureOptInStateFresh, isFeatureOptedInFresh } from "@/lib/license/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { passesActorFilter } from "../actor-filter";
import { activityCategoryOf, activityGradeOf } from "../activity-catalog";
import { activityFacts, factIds, type FactLookups } from "../activity-facts";
import { renderActivity, renderNotification, type Rendered } from "../render";
import type { SlackRule } from "../rules";
import { planDelivery } from "../schedule";
import { activityKeySet, activityLabel } from "./catalog";
import { SLACK_LICENSE_CLOSE_REASON } from "./license-transition";
import { loadLinks, loadRules, type SlackConnection, type SlackLink } from "./store";

/**
 * 인박스 → 아웃박스 펼치기. 인박스(0298a 트리거가 같은 트랜잭션에서 넣은 id)를 집어 원본을 읽고,
 * 켜진 규칙마다 · 대상마다 발송 한 줄을 만든다. `dedupe_key`가 UNIQUE라 다시 펼쳐도 두 번 나가지 않는다.
 * 알림은 받는 사람마다 한 행이라, 같은 알림(종류·제목·본문·링크·생성 시각)을 **한 사건으로 묶어** 채널엔 한 통만 보낸다.
 */
const BATCH = 300;
type Outbox = Record<string, unknown>;
type NotifRow = { id: string; type: string; title: string; body: string | null; link: string | null; recipient_id: string; actor_id: string | null; created_at: string };
// metadata는 여기서만 읽고 **허용 키만** facts로 바꿔 넘긴다(activity-facts.ts) — 렌더러·아웃박스엔 원본이 안 간다.
type AuditRow = { id: string; action: string; actor_id: string | null; actor_name: string | null; target_label: string | null; metadata: unknown; created_at: string };

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
      admin.from("audit_logs").select("id, action, actor_id, actor_name, target_label, metadata, created_at").eq("tenant_id", tenantId).in("id", c),
    ),
    loadRules(tenantId, keys),
    loadLinks(tenantId),
  ]);
  const rules = rulesLoad.status === "ok" ? rulesLoad.value.filter((r) => r.enabled && r.targets.length > 0) : [];
  const [names, lookups] = await Promise.all([
    recipientNames(tenantId, [...new Set(notifs.map((n) => n.recipient_id))]),
    factLookups(tenantId, audits.filter((a) => activityGradeOf(a.action) === "safe" && keys.has(a.action))),
  ]);

  // '자세히'의 **내용** 줄 = 감사로그 화면이 그 기록에 붙이는 한글 설명(`auditDetail`, 액션 350여 종의 단일 소스)
  // (원장 2026-09-29 *"on/off 이런것도 말해야지 그냥 너무 단순함"* · *"필요한 정보들은 전부"*). 슬랙 쪽에서 전후를 직접
  // 만든 액션(activity-change — 강사 시트 칸·출결 등)은 같은 말을 두 번 하지 않게 건너뛴다. 돈 계열(opaque)은 부르지 않는다.
  const nameOf = (id: unknown) =>
    typeof id === "string" ? (lookups.student.get(id)?.name ?? lookups.klass.get(id)?.name ?? null) : null;
  const withDetail = (a: AuditRow, f: ActivityFacts): ActivityFacts => {
    if (activityChange(a.action, a.metadata).rows.length) return f;
    let d: string | null = null;
    try {
      d = auditDetail(a.action, (a.metadata ?? null) as Record<string, unknown> | null, { nameOf, subjectLabel: lookups.subjectLabel });
    } catch {
      d = null; // 설명을 못 만들면 줄만 뺀다(발송은 막지 않는다)
    }
    const t = contentLine(d, f); // uuid 조각·중복 조각을 빼고, 가린 뒤 자른다
    return t ? { ...f, rows: [...f.rows, { label: "내용", value: t }] } : f;
  };

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
      // 빼기 · '누가'(0311a) — 고른 사람이 한 일만, 발동자 없는 알림(시스템 자동·PIN 화면)은 '누가'에 안 맞는다.
      if (!passesActorFilter(rule, head.actor_id)) continue;
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
    // 엑셀 가져오기가 남긴 행별 기록(반 담임·강의실 변경 등, metadata.excelImport = true)은 보내지 않는다 — 한 파일로 반 80개를 고치면
    // 80통이 된다(적대 리뷰 2026-09-29). 그 파일은 `excel_import` 한 줄로 알린다. 인박스는 아래에서 그대로 처리됨으로 넘어간다.
    if (fromExcelImport(a.metadata)) continue;
    const opaque = grade === "opaque";
    const ev = {
      label: activityLabel(a.action),
      opaque,
      targetLabel: a.target_label,
      actorName: a.actor_name,
      category: activityCategoryOf(a.action),
      facts: opaque ? undefined : withDetail(a, activityFacts(a.action, a.metadata, lookups)),
      moneyFacts: opaque ? moneyFacts(a.action, a.metadata) : undefined,
      createdAt: new Date(a.created_at),
    };
    for (const rule of rules) {
      if (rule.source !== "activity" || !rule.typeKeys.includes(a.action)) continue;
      if (!passesActorFilter(rule, a.actor_id)) continue;
      const rendered = renderActivity(ev, { template: rule.template, appUrl, ping: rule.ping });
      const inboxId = inboxBySource.get(`activity:${a.id}`);
      for (const t of rule.targets) {
        if (t.kind === "channel") push(rule, `a:${a.id}|${rule.id}|c:${t.channelId}`, inboxId, { kind: "channel", channelId: t.channelId }, rendered, a.created_at);
        else if (t.kind === "user_dm") pushDm(push, rule, `a:${a.id}|${rule.id}|u:${t.userId}`, inboxId, links, t.userId, rendered, a.created_at);
      }
    }
  }

  // drain 시작 때 켜져 있었어도 펼치는 동안 꺼졌거나 만료될 수 있다. 아웃박스 쓰기 직전에 DB를 다시 본다.
  if (!(await isFeatureOptedInFresh(tenantId, "slack"))) return 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error: upErr } = await admin.from("slack_outbox").upsert(rows.slice(i, i + 200), { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (upErr) throw new Error(`slack outbox upsert: ${upErr.message}`); // 인박스를 처리됨으로 넘기지 않는다 → 다음 실행이 다시 펼친다
  }
  // 끄기 정리와 아웃박스 insert가 엇갈려 정리 뒤에 생긴 줄도 닫는다. 자동 만료면 기존 대기는 건드리지 않고 이번 후보만 취소한다.
  if ((await getFeatureOptInStateFresh(tenantId, "slack")) === "disabled") {
    const dedupeKeys = rows.map((row) => String(row.dedupe_key));
    for (let i = 0; i < dedupeKeys.length; i += 100) {
      await admin
        .from("slack_outbox")
        .update({ status: "cancelled", last_error_code: SLACK_LICENSE_CLOSE_REASON })
        .eq("tenant_id", tenantId)
        .eq("status", "pending")
        .in("dedupe_key", dedupeKeys.slice(i, i + 100));
    }
    return 0;
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


/** 활동 facts의 이름 조회 — 허용 키(studentId·studentIds·classId)에서 모은 id만. 실패하면 이름 없이 보낸다(발송을 막지 않는다). */
async function factLookups(tenantId: string, audits: readonly AuditRow[]): Promise<FactLookups> {
  const studentIds = new Set<string>();
  const classIds = new Set<string>();
  for (const a of audits) {
    const f = factIds(a.metadata);
    f.students.forEach((id) => studentIds.add(id));
    f.classes.forEach((id) => classIds.add(id));
  }
  const admin = createAdminClient();
  try {
    const [students, classes, maps] = await Promise.all([
      fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null }>([...studentIds], (c) =>
        admin.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).in("id", c),
      ),
      fetchInChunks<{ id: string; class_name: string; subject: string | null }>([...classIds], (c) =>
        admin.from("classes").select("id, class_name, subject").eq("tenant_id", tenantId).in("id", c),
      ),
      // 설정 조회만 실패하면 과목 라벨만 빠진다(학생·반 이름은 산다).
      getTenantSettingsByTenantId(tenantId)
        .then((s) => buildSubjectMaps(s.operations.subjects))
        .catch((e) => {
          console.error("[slack] subject labels unavailable", e);
          return null;
        }),
    ]);
    return {
      student: new Map(students.map((s) => [s.id, { name: s.name, school: s.school, grade: s.grade }])),
      klass: new Map(classes.map((c) => [c.id, { name: c.class_name, subject: c.subject }])),
      // 설정에 없는 키는 labelOf가 원문을 돌려준다 — 영문 키는 싣지 않는다(raw 코드 노출 금지).
      subjectLabel: (k) => {
        const l = maps?.labelOf(k) ?? "";
        return /^[a-z0-9_]+$/i.test(l) ? "" : l;
      },
    };
  } catch (e) {
    console.error("[slack] activity facts lookup failed", e);
    return { student: new Map(), klass: new Map(), subjectLabel: () => "" };
  }
}

function fromExcelImport(meta: unknown): boolean {
  return !!meta && typeof meta === "object" && (meta as Record<string, unknown>).excelImport === true;
}
