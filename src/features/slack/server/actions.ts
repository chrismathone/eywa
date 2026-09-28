"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkSlackBotToken, describeSlackError, sanitizeSlackRoutes } from "../format";
import { slackAuthTest, slackListChannels, slackLookupByEmail, slackPostDm, slackPostMessage, type SlackChannel } from "./client";
import { slackGate } from "./gate";
import { loadSlackRow, saveSlackRow, SLACK_TABLE_MISSING_MESSAGE } from "./store";

/**
 * 슬랙 연결 설정(학원 설정 '연동' 면) — 원장·총괄만, 슈퍼관리자가 '슬랙 알림 연결'을 켠 지점만(`slackGate`).
 * 🔴 봇 토큰은 비밀번호와 같다 → 화면엔 가린 값만, 감사로그에도 싣지 않는다.
 */
export type SlackActionResult = { error?: string; message?: string };

async function connectedToken(tenantId: string): Promise<{ token: string } | { error: string }> {
  const loaded = await loadSlackRow(tenantId);
  if (loaded.status === "missing_table") return { error: SLACK_TABLE_MISSING_MESSAGE };
  if (loaded.status !== "ok" || !loaded.row?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  return { token: loaded.row.botToken };
}

export async function saveSlackToken(rawToken: string): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const checked = checkSlackBotToken(rawToken ?? "");
  if (!checked.ok) return { error: checked.error };
  const auth = await slackAuthTest(checked.token);
  if (!auth.ok) return { error: describeSlackError(auth.error) };
  const saved = await saveSlackRow(g.tenantId, g.userId, { botToken: checked.token, teamName: auth.team });
  if (saved.error) return saved;
  await logAction({ action: "slack_connection_token", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { team: auth.team } });
  revalidatePath("/owner");
  return { message: `'${auth.team}' 워크스페이스에 연결했습니다` };
}

export async function saveSlackRoutes(input: unknown): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const conn = await connectedToken(g.tenantId);
  if ("error" in conn) return conn;
  const routes = sanitizeSlackRoutes(input);
  const saved = await saveSlackRow(g.tenantId, g.userId, { routes });
  if (saved.error) return saved;
  await logAction({
    action: "slack_connection_routes",
    targetType: "integration",
    targetLabel: "슬랙 알림 연결",
    metadata: {
      routes: routes.map((r) => ({ to: r.kind === "dm" ? "1:1" : `#${r.channelName}`, eventTypes: r.eventTypes })),
    },
  });
  revalidatePath("/owner");
  return { message: "저장했습니다" };
}

export async function disconnectSlack(): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const saved = await saveSlackRow(g.tenantId, g.userId, { botToken: "", teamName: "" });
  if (saved.error) return saved;
  await logAction({ action: "slack_connection_disconnect", targetType: "integration", targetLabel: "슬랙 알림 연결" });
  revalidatePath("/owner");
  return { message: "연결을 해제했습니다" };
}

/**
 * 확인 메시지 — 저장된 채널 전부 + (1:1 줄에 알림을 골랐으면) 누른 사람 본인에게 1:1. 하나라도 실패하면 그 사유를 돌려준다.
 * 🔴 1:1을 안 쓰는데 1:1로 오면 "채널을 골랐는데 왜 개인 메시지로 오지?"가 된다(원장 2026-09-28). 보낼 곳이 하나도
 *    없을 때만 토큰 확인용으로 나에게 1:1을 보낸다.
 */
export async function sendSlackTest(): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const loaded = await loadSlackRow(g.tenantId);
  if (loaded.status !== "ok" || !loaded.row?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const { botToken: token, routes } = loaded.row;
  const text = "*[aywa] 슬랙 연결 확인*\n학원 설정에서 고른 aywa 알림이 이곳으로 옵니다.";
  const failures: string[] = [];
  let sent = 0;
  for (const r of routes) {
    if (r.kind !== "channel") continue;
    const res = await slackPostMessage(token, r.channelId, text);
    if (res.ok) sent++;
    else failures.push(`#${r.channelName}: ${describeSlackError(res.error)}`);
  }
  const dmOn = routes.some((r) => r.kind === "dm" && r.eventTypes.length > 0);
  const channelCount = routes.filter((r) => r.kind === "channel").length;
  // 1:1을 안 쓰는 설정이면 채널로만 확인한다.
  const me = dmOn || channelCount === 0 ? await slackLookupByEmail(token, g.email) : null;
  if (me?.ok) {
    const res = await slackPostDm(token, me.userId, text);
    if (res.ok) sent++;
    else failures.push(`나에게 1:1: ${describeSlackError(res.error)}`);
  } else if (me) failures.push(`나에게 1:1: ${describeSlackError(me.error)}`);
  await logAction({ action: "slack_connection_test", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { sent, failed: failures.length } });
  if (failures.length > 0) return { error: failures.join(" · "), message: sent ? `${sent}곳에 보냈습니다` : undefined };
  return { message: `${sent}곳에 확인 메시지를 보냈습니다` };
}

export async function listSlackChannels(): Promise<{ channels?: SlackChannel[]; error?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const conn = await connectedToken(g.tenantId);
  if ("error" in conn) return conn;
  const r = await slackListChannels(conn.token);
  return r.ok ? { channels: r.channels } : { error: describeSlackError(r.error) };
}

/** 직원 매칭 확인 — 재직 중 직원 중 같은 이메일의 슬랙 사용자가 없는 사람(1:1 알림을 못 받는 사람). */
export async function checkSlackMembers(): Promise<{ missing?: string[]; checked?: number; error?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const conn = await connectedToken(g.tenantId);
  if ("error" in conn) return conn;
  const { data, error } = await createAdminClient()
    .from("users")
    .select("display_name, email")
    .eq("tenant_id", g.tenantId)
    .eq("status", "active")
    .neq("system_role", "student")
    .order("display_name")
    .limit(200);
  if (error) return { error: "직원 목록을 읽지 못했습니다" };
  const missing: string[] = [];
  let checked = 0;
  for (const u of data ?? []) {
    const email = (u.email as string) ?? "";
    if (!email.includes("@")) {
      missing.push(u.display_name as string);
      continue;
    }
    const r = await slackLookupByEmail(conn.token, email);
    if (!r.ok && r.error !== "users_not_found") return { error: describeSlackError(r.error) };
    checked++;
    if (!r.ok) missing.push(u.display_name as string);
  }
  return { missing, checked };
}
