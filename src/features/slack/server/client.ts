import "server-only";

/**
 * 슬랙 Web API 최소 래퍼 — 봇 토큰(xoxb) 하나로 쓴다. 필요한 권한(scope):
 *   chat:write · chat:write.public(초대 없이 공개 채널) · channels:read · groups:read(채널 목록)
 *   im:write(1:1 열기) · users:read · users:read.email(이메일로 사람 찾기)
 * 응답은 `{ ok, error? , ...}` — 실패는 throw하지 않고 `{ ok: false, error }`(null = 네트워크·시간 초과).
 * 🔴 본문은 **폼 인코딩**으로 보낸다 — conversations.list·users.lookupByEmail 같은 읽기 메서드는 JSON 본문을 받지 않는다
 *    (조용히 인자를 무시한다). chat.postMessage도 폼을 받으니 하나로 통일.
 */
type SlackResult<T> = ({ ok: true } & T) | { ok: false; error: string | null };

async function call<T>(
  token: string,
  method: string,
  params: Record<string, string | number | boolean>,
): Promise<SlackResult<T>> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.status === 429) return { ok: false, error: "ratelimited" };
    const json = (await res.json()) as { ok?: boolean; error?: string } & T;
    if (!json.ok) return { ok: false, error: json.error ?? "unknown" };
    return { ...json, ok: true };
  } catch {
    return { ok: false, error: null };
  }
}

/** 토큰 확인 — 워크스페이스 이름을 돌려준다. */
export async function slackAuthTest(token: string): Promise<SlackResult<{ team: string }>> {
  const r = await call<{ team?: string }>(token, "auth.test", {});
  return r.ok ? { ok: true, team: r.team ?? "" } : r;
}

export type SlackChannel = { id: string; name: string; isPrivate: boolean };

/** 채널 목록 — 공개 채널 전부 + 봇이 초대된 비공개 채널. 보관된 채널 제외, 최대 1,000개. */
export async function slackListChannels(token: string): Promise<SlackResult<{ channels: SlackChannel[] }>> {
  const channels: SlackChannel[] = [];
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const r = await call<{
      channels?: { id: string; name: string; is_private?: boolean }[];
      response_metadata?: { next_cursor?: string };
    }>(token, "conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    if (!r.ok) return r;
    for (const c of r.channels ?? []) channels.push({ id: c.id, name: c.name, isPrivate: !!c.is_private });
    cursor = r.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  channels.sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return { ok: true, channels };
}

/** 이메일 → 슬랙 사용자 id. 없으면 `users_not_found`. */
export async function slackLookupByEmail(token: string, email: string): Promise<SlackResult<{ userId: string }>> {
  const r = await call<{ user?: { id?: string } }>(token, "users.lookupByEmail", { email });
  if (!r.ok) return r;
  return r.user?.id ? { ok: true, userId: r.user.id } : { ok: false, error: "users_not_found" };
}

/** 1:1 대화방 id(봇 ↔ 그 사람). */
async function slackOpenDm(token: string, userId: string): Promise<SlackResult<{ channelId: string }>> {
  const r = await call<{ channel?: { id?: string } }>(token, "conversations.open", { users: userId });
  if (!r.ok) return r;
  return r.channel?.id ? { ok: true, channelId: r.channel.id } : { ok: false, error: "unknown" };
}

export async function slackPostMessage(token: string, channel: string, text: string): Promise<SlackResult<object>> {
  // unfurl 끔 — 'aywa에서 열기' 링크가 로그인 화면 미리보기로 부풀지 않게.
  return call<object>(token, "chat.postMessage", { channel, text, mrkdwn: true, unfurl_links: false, unfurl_media: false });
}

export async function slackPostDm(token: string, userId: string, text: string): Promise<SlackResult<object>> {
  const dm = await slackOpenDm(token, userId);
  if (!dm.ok) return dm;
  return slackPostMessage(token, dm.channelId, text);
}
