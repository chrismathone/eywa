import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isFeatureOptedIn } from "@/lib/license/server";
import { reportError } from "@/lib/observability/report-error";
import {
  buildSlackDigestText,
  buildSlackText,
  planForwardMessages,
  SLACK_MAX_MESSAGES_PER_BATCH,
  type ForwardMessage,
  type ForwardRow,
} from "../format";
import { slackLookupByEmail, slackPostDm, slackPostMessage } from "./client";
import { loadSlackRow } from "./store";

/**
 * aywa 알림 → 슬랙 전달(2026-09-28). `notifyUsers()`가 알림을 넣은 뒤 부른다.
 * - **응답 뒤에** 돈다(`after`) — 슬랙이 느리거나 죽어도 본 작업 응답을 늦추지 않는다(반응속도 1순위).
 * - 게이트: 슈퍼관리자 스위치(`isFeatureOptedIn(…, "slack")`, 기본 꺼짐) ∧ 원장이 등록한 봇 토큰 ∧ 보낼 곳별로 고른 종류.
 * - 보낼 곳 둘: 채널(같은 알림은 한 통 + 받는 사람 이름) · 1:1(그 알림을 받는 aywa 사용자 본인, 이메일로 슬랙 사용자 매칭).
 * - best-effort — 실패는 로그만(알림은 이미 aywa에 있다). 재시도 없음.
 */
export type NotificationInsertRow = {
  tenant_id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
};

export function scheduleSlackForward(rows: readonly NotificationInsertRow[]): void {
  if (rows.length === 0) return;
  const run = () => forwardToSlack(rows).catch((e) => reportError(e, { scope: "slack.forward" }));
  try {
    after(run);
  } catch {
    void run(); // 요청 밖에서 불린 경우 — after를 못 쓰니 흘려보낸다.
  }
}

/** 알림 링크를 절대 주소로 만들 앱 주소 — 모르면 null(링크 줄을 뺀다). 샘플 알림도 같은 값을 쓴다. */
export function appUrlOrNull(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  return vercel ? `https://${vercel}` : null;
}

async function forwardToSlack(rows: readonly NotificationInsertRow[]): Promise<void> {
  const byTenant = new Map<string, NotificationInsertRow[]>();
  for (const r of rows) byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r]);
  for (const [tenantId, list] of byTenant) await forwardTenant(tenantId, list);
}

async function forwardTenant(tenantId: string, rows: NotificationInsertRow[]): Promise<void> {
  if (!(await isFeatureOptedIn(tenantId, "slack"))) return;
  const loaded = await loadSlackRow(tenantId);
  if (loaded.status !== "ok" || !loaded.row?.botToken) return;
  const { botToken: token, routes } = loaded.row;
  const forwardRows: ForwardRow[] = rows.map((r) => ({
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    recipientId: r.recipient_id,
  }));

  const plans = routes
    .map((route) => ({ route, messages: planForwardMessages(forwardRows, new Set(route.eventTypes)) }))
    .filter((p) => p.messages.length > 0);
  if (plans.length === 0) return;

  const people = await loadPeople(tenantId, [...new Set(plans.flatMap((p) => p.messages.flatMap((m) => m.recipientIds)))]);
  const appUrl = appUrlOrNull();

  for (const { route, messages } of plans) {
    if (route.kind === "channel") {
      const texts =
        messages.length > SLACK_MAX_MESSAGES_PER_BATCH
          ? [buildSlackDigestText(messages)]
          : messages.map((m) => buildSlackText(m, appUrl, names(m, people)));
      for (const text of texts) report(await slackPostMessage(token, route.channelId, text), tenantId, "channel");
    } else {
      await sendDms(token, tenantId, messages, people, appUrl);
    }
  }
}

type Person = { name: string; email: string };

function names(m: ForwardMessage, people: Map<string, Person>): string[] {
  return m.recipientIds.map((id) => people.get(id)?.name).filter((n): n is string => !!n);
}

/** 1:1 — 받는 사람마다 자기 알림만. 이메일로 슬랙 사용자를 찾고, 못 찾으면 그 사람은 건너뛴다. */
async function sendDms(
  token: string,
  tenantId: string,
  messages: ForwardMessage[],
  people: Map<string, Person>,
  appUrl: string | null,
): Promise<void> {
  const byRecipient = new Map<string, ForwardMessage[]>();
  for (const m of messages) for (const id of m.recipientIds) byRecipient.set(id, [...(byRecipient.get(id) ?? []), m]);
  for (const [recipientId, mine] of byRecipient) {
    const email = people.get(recipientId)?.email;
    if (!email) continue;
    const who = await slackLookupByEmail(token, email);
    if (!who.ok) {
      if (who.error !== "users_not_found") report(who, tenantId, "lookup");
      continue;
    }
    const texts =
      mine.length > SLACK_MAX_MESSAGES_PER_BATCH ? [buildSlackDigestText(mine)] : mine.map((m) => buildSlackText(m, appUrl));
    for (const text of texts) report(await slackPostDm(token, who.userId, text), tenantId, "dm");
  }
}

async function loadPeople(tenantId: string, ids: string[]): Promise<Map<string, Person>> {
  try {
    const admin = createAdminClient();
    const data = await fetchInChunks<{ id: string; display_name: string; email: string }>(ids, (chunk) =>
      admin.from("users").select("id, display_name, email").eq("tenant_id", tenantId).in("id", chunk),
    );
    return new Map(data.map((u) => [u.id, { name: u.display_name, email: u.email }]));
  } catch (e) {
    reportError(e, { scope: "slack.load_people" }); // 이름·이메일을 못 읽으면 채널엔 이름 없이, 1:1은 건너뛴다.
    return new Map();
  }
}

function report(res: { ok: boolean; error?: string | null }, tenantId: string, where: string): void {
  if (!res.ok) reportError(new Error(`slack ${where} failed: ${res.error ?? "network"}`), { scope: "slack.send", tenantId });
}
