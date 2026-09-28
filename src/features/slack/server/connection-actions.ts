"use server";

import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { checkSlackBotToken, describeSlackError } from "../format";
import { normalizeTime } from "../rules";
import { slackAuthTest, slackListChannels, type SlackChannel } from "./client";
import { slackGate } from "./gate";
import { loadConnection, saveConnection, SLACK_TABLE_MISSING_MESSAGE } from "./store";

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
  await logAction({ action: "slack_connection_token", targetType: "integration", targetLabel: "슬랙 알림 연결", metadata: { team: auth.team } });
  revalidatePath("/owner");
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

export async function listSlackChannels(): Promise<{ channels?: SlackChannel[]; error?: string }> {
  const g = await slackGate();
  if ("error" in g) return g;
  const loaded = await loadConnection(g.tenantId);
  if (loaded.status !== "ok" || !loaded.value?.botToken) return { error: "먼저 봇 토큰을 등록해 주세요" };
  const r = await slackListChannels(loaded.value.botToken);
  return r.ok ? { channels: r.channels } : { error: describeSlackError(r.error) };
}
