"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { checkSlackBotToken, describeSlackError, missingSlackScopes } from "../format";
import { createAdminClient } from "@/lib/supabase/admin";
import { pokeSlack } from "./poke";
import { normalizeTime } from "../rules";
import { slackAuthTest, slackListChannels, type SlackChannel } from "./client";
import { slackGate } from "./gate";
import { loadConnection, saveConnection, SLACK_TABLE_MISSING_MESSAGE } from "./store";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * 슬랙 연결 · 발송 시간 설정(학원 설정 '연동' 면) — 원장·총괄만, 슈퍼관리자가 '슬랙 알림 연결'을 켠 지점만(`slackGate`).
 * 🔴 봇 토큰은 비밀번호와 같다 → 화면엔 가린 값만, 감사로그에도 싣지 않는다.
 */
export type SlackActionResult = { error?: string; message?: string };

export async function saveSlackToken(rawToken: string): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const checked = checkSlackBotToken(rawToken ?? "");
  if (!checked.ok) return { error: checked.error };
  const auth = await slackAuthTest(checked.token);
  if (!auth.ok) return { error: describeSlackError(auth.error) };
  // 새 토큰이면 '끊김'을 풀고 마지막 오류를 지운다 — 쌓여 있던 대기 줄이 이어서 나간다.
  const saved = await saveConnection(g.tenantId, g.userId, {
    bot_token: checked.token,
    team_name: auth.team,
    team_id: auth.teamId,
    bot_user_id: auth.botUserId,
    status: "active",
    last_error_code: null,
    last_error_at: null,
  });
  if (saved.error) return saved;
  // 권한 헤더가 안 왔으면(드묾) 비교하지 않는다 — 전부 빠졌다고 잘못 경고하지 않게.
  const missing = auth.scopes.length ? missingSlackScopes(auth.scopes) : [];
  await logAction({ action: "slack_connection_token", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { team: auth.team, missingScopes: missing.length } });
  revalidatePath("/owner");
  pokeSlack(g.tenantId); // 끊긴 동안 쌓인 것(0299a)을 바로 이어서 보낸다
  // auth.test 성공은 토큰이 살아 있다는 뜻일 뿐 — 보낼 권한까지는 따로 본다(codex 2차).
  if (missing.length) {
    return {
      message: `'${auth.team}' 워크스페이스에 연결했습니다`,
      error: `슬랙 앱에 이 권한이 빠져 있습니다: ${missing.join(", ")} — 앱 설정(OAuth & Permissions)에서 추가하고 '다시 설치' 한 뒤 새 토큰을 저장해 주세요`,
    };
  }
  return { message: `'${auth.team}' 워크스페이스에 연결했습니다` };
}

export async function disconnectSlack(): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const saved = await saveConnection(g.tenantId, g.userId, { bot_token: "", team_name: "" });
  if (saved.error) return saved;
  await logAction({ action: "slack_connection_disconnect", targetType: "integration", targetLabel: "슬랙 알림 연결" });
  revalidatePath("/owner");
  return { message: "연결을 해제했습니다" };
}

export type SlackScheduleInput = {
  dndEnabled: boolean;
  dndStart: string;
  dndEnd: string;
  weekendQuiet: boolean;
  digestAt: string;
};

export async function saveSlackSchedule(input: SlackScheduleInput): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const dndStart = normalizeTime(input.dndStart);
  const dndEnd = normalizeTime(input.dndEnd);
  const digestAt = normalizeTime(input.digestAt);
  if (!dndStart || !dndEnd || !digestAt) return { error: "시각은 00:00 ~ 23:59 형식으로 넣어 주세요" };
  const current = await loadConnection(g.tenantId);
  if (current.status === "missing_table") return { error: SLACK_TABLE_MISSING_MESSAGE };
  if (current.status !== "ok" || !current.value?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const patch = { dnd_enabled: input.dndEnabled === true, dnd_start: dndStart, dnd_end: dndEnd, weekend_quiet: input.weekendQuiet === true, digest_at: digestAt };
  const saved = await saveConnection(g.tenantId, g.userId, patch);
  if (saved.error) return saved;
  await logAction({
    action: "slack_schedule_update",
    targetType: "integration",
    targetLabel: "슬랙 알림 연결",
    metadata: { dndEnabled: patch.dnd_enabled, dndStart, dndEnd, weekendQuiet: patch.weekend_quiet, digestAt },
  });
  revalidatePath("/owner");
  return { message: "발송 시간을 저장했습니다" };
}

/**
 * 다시 보내기 — 최근 48시간 동안 포기(dead)된 발송을 다시 대기로. 채널 초대·사람 연결을 고친 뒤 누른다(codex 2차: "수정 후 재발송 수단").
 * 1:1은 보내는 순간 연결을 다시 보므로, 그 사이 연결한 사람에게는 이번엔 간다.
 */
export async function resendSlackFailures(): Promise<SlackActionResult> {
  const g = await slackGate();
  if ("error" in g) return g;
  const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
  const now = new Date().toISOString();
  const { data, error } = await createAdminClient()
    .from("slack_outbox")
    .update({ status: "pending", attempt_count: 0, next_attempt_at: now, due_at: now, last_error_code: null })
    .eq("tenant_id", g.tenantId)
    .eq("status", "dead")
    .gte("created_at", since)
    .select("id");
  if (error) {
    logDbError(error, "slack.resendSlackFailures");
    return { error: "다시 보내지 못했습니다" };
  }
  const n = data?.length ?? 0;
  if (n === 0) return { message: "다시 보낼 실패 건이 없습니다" };
  await logAction({ action: "slack_resend", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { count: n } });
  pokeSlack(g.tenantId);
  revalidatePath("/owner");
  return { message: `${n}건을 다시 보냅니다 — 1분 안에 나갑니다` };
}

export async function listSlackChannels(): Promise<{ channels?: SlackChannel[]; error?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const loaded = await loadConnection(g.tenantId);
  if (loaded.status !== "ok" || !loaded.value?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const r = await slackListChannels(loaded.value.botToken);
  return r.ok ? { channels: r.channels } : { error: describeSlackError(r.error) };
}
