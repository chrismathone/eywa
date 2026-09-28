"use server";

import { logAction } from "@/features/audit/server/log";
import { buildSlackText, describeSlackError, type ForwardMessage } from "../format";
import { SAMPLE_FOOTER, SAMPLE_NOTIFICATIONS, SAMPLE_RECIPIENTS } from "../samples";
import { slackLookupByEmail, slackPostDm, slackPostMessage } from "./client";
import { appUrlOrNull } from "./forward";
import { slackGate } from "./gate";
import { loadSlackRow } from "./store";

/**
 * 샘플 알림 — **저장된** 보낼 곳마다, 거기서 고른 알림 종류별로 **실제 알림과 똑같은 모양**을 가상 데이터로 보낸다
 * (원장 2026-09-28 *"테스트 알림 보낼 수 있게 해줄래?"* → *"실제로 나가는 알림처럼 보여줘 테스트 알림들은. 가상 데이터로"*).
 * 문구는 [`samples.ts`](../samples.ts), 조립은 실제 알림과 같은 `buildSlackText`. 맨 아래 한 줄로 테스트임을 밝힌다.
 * 🔴 1:1 줄은 **누른 사람 본인에게만** 보낸다 — 샘플이 다른 직원에게 가면 진짜 알림으로 오해한다.
 * 한 곳에 종류가 많으면 앞 3종만(나머지는 개수만 알린다) — 슬랙 채널당 초당 1통 한도.
 */
const MAX_SAMPLES_PER_ROUTE = 3;

function sampleText(type: string, appUrl: string | null, channel: boolean): string | null {
  const s = SAMPLE_NOTIFICATIONS[type];
  if (!s) return null;
  const m: ForwardMessage = { type, title: s.title, body: s.body, link: s.link, recipientIds: [] };
  return `${buildSlackText(m, appUrl, channel ? SAMPLE_RECIPIENTS : [])}\n${SAMPLE_FOOTER}`;
}

export async function sendSlackSamples(): Promise<{ error?: string; message?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const loaded = await loadSlackRow(g.tenantId);
  if (loaded.status !== "ok" || !loaded.row?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const { botToken: token, routes } = loaded.row;
  const active = routes.filter((r) => r.eventTypes.length > 0);
  if (active.length === 0) return { error: "알림을 고른 보낼 곳이 없습니다 — 알림을 고르고 저장한 뒤 눌러 주세요" };

  const appUrl = appUrlOrNull();
  const failures: string[] = [];
  let sent = 0;
  let skipped = 0;
  let dmUserId: string | null = null;

  for (const route of active) {
    const types = route.eventTypes.slice(0, MAX_SAMPLES_PER_ROUTE);
    skipped += route.eventTypes.length - types.length;
    const where = route.kind === "dm" ? "나에게 1:1" : `#${route.channelName}`;
    if (route.kind === "dm" && !dmUserId) {
      const who = await slackLookupByEmail(token, g.email);
      if (!who.ok) {
        failures.push(`${where}: ${describeSlackError(who.error)}`);
        continue;
      }
      dmUserId = who.userId;
    }
    for (const type of types) {
      const text = sampleText(type, appUrl, route.kind === "channel");
      if (!text) continue;
      const res =
        route.kind === "dm"
          ? await slackPostDm(token, dmUserId!, text)
          : await slackPostMessage(token, route.channelId, text);
      if (res.ok) sent++;
      else {
        failures.push(`${where}: ${describeSlackError(res.error)}`);
        break; // 같은 곳의 나머지 종류도 같은 이유로 실패한다.
      }
    }
  }

  await logAction({
    action: "slack_connection_sample",
    targetType: "integration",
    targetLabel: "슬랙 알림 연결",
    metadata: { sent, failed: failures.length },
  });
  const note = skipped > 0 ? ` (종류가 많은 곳은 앞 ${MAX_SAMPLES_PER_ROUTE}종만 · ${skipped}종 생략)` : "";
  if (failures.length > 0) {
    return { error: failures.join(" · "), message: sent ? `샘플 ${sent}통을 보냈습니다${note}` : undefined };
  }
  return { message: `샘플 알림 ${sent}통을 보냈습니다${note}` };
}
