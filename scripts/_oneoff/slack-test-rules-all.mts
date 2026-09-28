/**
 * 슬랙 테스트 규칙 2개 — 모든 알림 · 모든 활동 기록을 박소선(st2000423@gmail.com) 1:1로 (원장 2026-09-28
 * *"st2000423@gmail.com에게 모든 메시지 발송되도록 규칙 테스트 추가"*). 앱 규칙 저장과 같은 정리(`sanitizeRule`)를 거친다.
 * 실행: npx tsx scripts/_oneoff/slack-test-rules-all.mts [--apply]
 * 기본은 드라이런(쓰기 없음). 자격증명은 출력하지 않는다. 감사로그를 함께 남긴다.
 * 지우는 법: 오너 화면 '연동 → 슬랙 → 규칙'에서 두 규칙을 삭제한다.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { FORWARD_EVENT_OPTIONS } from "../../src/features/slack/events";
import { activityGradeOf } from "../../src/features/slack/activity-catalog";
import { emptyRule, nextKeySince, sanitizeRule, SLACK_MAX_RULES } from "../../src/features/slack/rules";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  readFileSync("D:/eywa_refactoring/.env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: user, error: uErr } = await db
  .from("users")
  .select("id, tenant_id, display_name")
  .ilike("email", "st2000423@gmail.com")
  .single();
if (uErr || !user) throw new Error("대상 사용자를 찾지 못했습니다");
const { data: link } = await db
  .from("slack_user_links")
  .select("slack_user_id")
  .eq("tenant_id", user.tenant_id)
  .eq("aywa_user_id", user.id)
  .maybeSingle();
if (!link) throw new Error("대상 사용자가 슬랙에 연결돼 있지 않습니다 — 1:1이 안 나간다");

// log.ts는 server-only라 텍스트로 읽는다(activity-catalog.test와 같은 방식) — 앱의 activityKeySet()과 같은 키.
const logSrc = readFileSync("src/features/audit/server/log.ts", "utf8");
const auditBody = logSrc.slice(logSrc.indexOf("export const AUDIT_ACTIONS = {"), logSrc.indexOf("} as const;", logSrc.indexOf("export const AUDIT_ACTIONS = {")));
const activityKeys = new Set([...auditBody.matchAll(/^\s{2}([a-z][a-z0-9_]*):\s*"/gm)].map((m) => m[1]!));
if (activityKeys.size < 300) throw new Error("감사로그 키를 읽지 못했습니다");
const target = { kind: "user_dm", userId: user.id, userName: user.display_name };
const rules = [
  sanitizeRule(
    {
      ...emptyRule("notification"),
      name: "테스트: 모든 알림 → 박소선",
      typeKeys: FORWARD_EVENT_OPTIONS.map((o) => o.type),
      targets: [target],
    },
    activityKeys,
  ),
  sanitizeRule(
    {
      ...emptyRule("activity"),
      name: "테스트: 모든 활동 → 박소선",
      typeKeys: [...activityKeys].filter((k) => activityGradeOf(k) !== "forbid"),
      targets: [target],
    },
    activityKeys,
  ),
];
for (const r of rules) {
  if (!r || r.typeKeys.length === 0) throw new Error("규칙 정리 실패");
  console.log(`${r.name}: ${r.source} ${r.typeKeys.length}종 → ${r.targets.length}곳 · 방해금지 ${r.honorDnd ? "지킴" : "무시"}`);
}

const { count } = await db.from("slack_rules").select("id", { count: "exact", head: true }).eq("tenant_id", user.tenant_id);
if ((count ?? 0) + rules.length > SLACK_MAX_RULES) throw new Error("규칙 개수 한도 초과");
const { data: dup } = await db.from("slack_rules").select("name").eq("tenant_id", user.tenant_id).like("name", "테스트: 모든%");
if (dup && dup.length > 0) throw new Error(`이미 있음: ${dup.map((d) => d.name).join(", ")}`);

if (!APPLY) {
  console.log("드라이런 — 쓰지 않았습니다. --apply로 실행하면 저장합니다.");
  process.exit(0);
}
const now = new Date().toISOString();
for (const r of rules) {
  const { data, error } = await db
    .from("slack_rules")
    .insert({
      tenant_id: user.tenant_id,
      name: r!.name,
      enabled: true,
      source: r!.source,
      type_keys: r!.typeKeys,
      targets: r!.targets,
      template: r!.template,
      mention_recipients: r!.mentionRecipients,
      ping: r!.ping,
      exclude_actor_ids: r!.excludeActorIds,
      timing: r!.timing,
      digest_at: r!.digestAt,
      honor_dnd: r!.honorDnd,
      key_since: nextKeySince(null, r!, now),
      updated_at: now,
    })
    .select("id")
    .single();
  if (error) throw new Error(`저장 실패: ${error.message}`);
  await db.from("audit_logs").insert({
    tenant_id: user.tenant_id,
    actor_id: null,
    actor_name: "시스템(원장 요청 테스트 규칙)",
    action: "slack_rule_save",
    target_type: "integration",
    target_label: r!.name,
    metadata: { created: true, enabled: true, source: r!.source, typeCount: r!.typeKeys.length, targets: [`${user.display_name}(1:1)`], timing: r!.timing, ruleId: data.id },
  });
  console.log(`저장: ${r!.name}`);
}
