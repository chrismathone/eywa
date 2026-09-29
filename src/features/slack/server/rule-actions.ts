"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { activityCategoryOf, activityGradeOf } from "../activity-catalog";
import { describeSlackError } from "../format";
import { renderActivity, renderNotification } from "../render";
import { sanitizeRule, SLACK_MAX_RULES, targetLabel, type SlackRule } from "../rules";
import { SAMPLE_ACTIVITY_FACTS, SAMPLE_FOOTER, SAMPLE_NOTIFICATIONS, SAMPLE_RECIPIENTS } from "../samples";
import { activityKeySet, activityLabel } from "./catalog";
import { slackPostDm, slackPostMessage } from "./client";
import { appUrlOrNull } from "./dispatch";
import { slackGate } from "./gate";
import { deleteRule, loadConnection, loadLinks, loadRules, upsertRule } from "./store";

/**
 * 슬랙 규칙 저장·삭제·샘플 — 원장·총괄만(`slackGate`). 규칙 변경은 감사로그에 남긴다(토큰·본문 없이 설정만).
 * 저장은 `version`이 같을 때만(동시 편집 = 다른 사람이 먼저 저장했으면 거절하고 새로고침을 요청).
 */
type Result = { error?: string; message?: string; rule?: SlackRule };

export async function saveSlackRule(input: unknown): Promise<Result> {
  const g = await slackGate();
  if ("error" in g) return g;
  const keys = activityKeySet();
  const rule = sanitizeRule(input, keys);
  if (!rule) return { error: "규칙 모양이 올바르지 않습니다" };
  if (rule.typeKeys.length === 0) return { error: "보낼 알림·활동을 하나 이상 골라 주세요" };
  if (rule.targets.length === 0) return { error: "보낼 곳(채널·사람)을 하나 이상 골라 주세요" };
  if (!rule.id) {
    const existing = await loadRules(g.tenantId, keys);
    if (existing.status === "ok" && existing.value.length >= SLACK_MAX_RULES) return { error: `규칙은 ${SLACK_MAX_RULES}개까지 만들 수 있습니다` };
  }
  const saved = await upsertRule(g.tenantId, g.userId, rule);
  if (saved.error || !saved.id) return { error: saved.error ?? "규칙을 저장하지 못했습니다" };
  await logAction({
    action: "slack_rule_save",
    targetType: "integration",
    targetLabel: rule.name,
    metadata: {
      created: !rule.id,
      enabled: rule.enabled,
      source: rule.source,
      typeCount: rule.typeKeys.length,
      targets: rule.targets.map(targetLabel),
      timing: rule.timing,
    },
  });
  revalidatePath("/owner");
  return { message: "규칙을 저장했습니다", rule: { ...rule, id: saved.id, version: saved.version ?? rule.version + 1 } };
}

export async function deleteSlackRule(ruleId: string, ruleName: string): Promise<Result> {
  const g = await slackGate();
  if ("error" in g) return g;
  const res = await deleteRule(g.tenantId, ruleId);
  if (res.error) return res;
  await logAction({ action: "slack_rule_delete", targetType: "integration", targetLabel: ruleName.slice(0, 60) });
  revalidatePath("/owner");
  return { message: "규칙을 지웠습니다" };
}

/**
 * 샘플 — **저장된** 규칙의 앞 3종을 실제와 같은 모양 + 가상 데이터로. 채널은 그 채널에,
 * 1:1 대상(받는 사람·정해 둔 사람)은 **누른 사람 본인에게만**(샘플이 다른 직원에게 가면 진짜로 오해한다).
 */
export async function sendSlackRuleSample(ruleId: string): Promise<Result> {
  const g = await slackGate();
  if ("error" in g) return g;
  const [conn, rules, links] = await Promise.all([loadConnection(g.tenantId), loadRules(g.tenantId, activityKeySet()), loadLinks(g.tenantId)]);
  if (conn.status !== "ok" || !conn.value?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const rule = rules.status === "ok" ? rules.value.find((r) => r.id === ruleId) : undefined;
  if (!rule) return { error: "저장된 규칙이 아닙니다 — 먼저 저장해 주세요" };

  const appUrl = appUrlOrNull();
  const style = { template: rule.template, appUrl, ping: "none" as const }; // 샘플로 채널 전체를 호출하지 않는다
  const texts = rule.typeKeys.slice(0, 3).map((key) => {
    if (rule.source === "notification") {
      const s = SAMPLE_NOTIFICATIONS[key] ?? { title: "알림 예시", body: "", link: "/" };
      const ev = { type: key, title: s.title, body: s.body, link: s.link, createdAt: new Date() };
      return (channel: boolean) => `${renderNotification(ev, style, channel && rule.template === "detailed" ? SAMPLE_RECIPIENTS : []).body}\n${SAMPLE_FOOTER}`;
    }
    const ev = {
      label: activityLabel(key),
      opaque: activityGradeOf(key) === "opaque",
      targetLabel: null,
      category: activityCategoryOf(key),
      facts: SAMPLE_ACTIVITY_FACTS,
      actorName: "박지현",
      createdAt: new Date(),
    };
    return () => `${renderActivity(ev, style).body}\n${SAMPLE_FOOTER}`;
  });

  const token = conn.value.botToken;
  const me = links.get(g.userId);
  const failures: string[] = [];
  let sent = 0;
  let dmDone = false;
  for (const t of rule.targets) {
    const isDm = t.kind !== "channel";
    if (isDm && dmDone) continue;
    if (isDm && !me) {
      failures.push("1:1 샘플: 내 슬랙 계정이 연결돼 있지 않습니다('내 정보'에서 연결)");
      dmDone = true;
      continue;
    }
    for (const text of texts) {
      const res =
        t.kind === "channel" ? await slackPostMessage(token, t.channelId, text(true)) : await slackPostDm(token, me!.slackUserId, text(false));
      if (res.ok) sent++;
      else {
        failures.push(`${isDm ? "나에게 1:1" : targetLabel(t)}: ${describeSlackError(res.error)}`);
        break;
      }
    }
    if (isDm) dmDone = true;
  }
  await logAction({ action: "slack_connection_sample", targetType: "integration", targetLabel: rule.name, metadata: { sent, failed: failures.length } });
  if (failures.length) return { error: failures.join(" · "), message: sent ? `샘플 ${sent}통을 보냈습니다` : undefined };
  return { message: `샘플 ${sent}통을 보냈습니다${rule.typeKeys.length > 3 ? " (앞 3종)" : ""}` };
}
