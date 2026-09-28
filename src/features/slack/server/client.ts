import "server-only";

/**
 * 슬랙 Web API 최소 래퍼 — 지점 봇 토큰(xoxb) 하나로 쓴다. 필요한 권한(scope):
 *   chat:write · chat:write.public(초대 없이 공개 채널) · channels:read · groups:read(채널 목록)
 *   im:write(1:1 열기) · users:read · users:read.email(사람 연결 후보)
 * 실패는 throw하지 않고 `{ ok: false, error, retryAfter? }`(error null = 네트워크·시간 초과).
 * 🔴 본문은 **폼 인코딩** — conversations.list·users.lookupByEmail 같은 읽기 메서드는 JSON 본문의 인자를 조용히 무시한다.
 */
export type SlackFail = { ok: false; error: string | null; retryAfter?: number };
type SlackResult<T> = ({ ok: true } & T) | SlackFail;

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
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (res.status === 429) {
      return { ok: false, error: "ratelimited", retryAfter: Number(res.headers.get("retry-after")) || 30 };
    }
    const json = (await res.json()) as { ok?: boolean; error?: string } & T;
    if (!json.ok) return { ok: false, error: json.error ?? "unknown" };
    return { ...json, ok: true };
  } catch {
    return { ok: false, error: null };
  }
}

/** 토큰 확인 — 워크스페이스 이름·id와 봇 사용자 id. */
export async function slackAuthTest(token: string): Promise<SlackResult<{ team: string; teamId: string; botUserId: string }>> {
  const r = await call<{ team?: string; team_id?: string; user_id?: string }>(token, "auth.test", {});
  return r.ok ? { ok: true, team: r.team ?? "", teamId: r.team_id ?? "", botUserId: r.user_id ?? "" } : r;
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

export type SlackMember = { id: string; email: string; name: string };

/** 워크스페이스 사람 목록(봇·삭제·게스트 제외) — 이메일 일치 **후보**를 한 번에 만든다(lookupByEmail N번 대신). */
export async function slackListMembers(token: string): Promise<SlackResult<{ members: SlackMember[] }>> {
  const members: SlackMember[] = [];
  let cursor = "";
  for (let page = 0; page < 10; page++) {
    const r = await call<{
      members?: {
        id: string;
        deleted?: boolean;
        is_bot?: boolean;
        is_restricted?: boolean;
        real_name?: string;
        name?: string;
        profile?: { email?: string; real_name?: string; display_name?: string };
      }[];
      response_metadata?: { next_cursor?: string };
    }>(token, "users.list", { limit: 200, ...(cursor ? { cursor } : {}) });
    if (!r.ok) return r;
    for (const m of r.members ?? []) {
      if (m.deleted || m.is_bot || m.id === "USLACKBOT") continue;
      members.push({
        id: m.id,
        email: (m.profile?.email ?? "").toLowerCase(),
        name: m.profile?.display_name || m.profile?.real_name || m.real_name || m.name || "",
      });
    }
    cursor = r.response_metadata?.next_cursor ?? "";
    if (!cursor) break;
  }
  return { ok: true, members };
}

/** 이메일 → 슬랙 사용자 id. 없으면 `users_not_found`. */
export async function slackLookupByEmail(token: string, email: string): Promise<SlackResult<{ userId: string }>> {
  const r = await call<{ user?: { id?: string } }>(token, "users.lookupByEmail", { email });
  if (!r.ok) return r;
  return r.user?.id ? { ok: true, userId: r.user.id } : { ok: false, error: "users_not_found" };
}

export type SlackPosted = { channel: string; ts: string };

export async function slackPostMessage(token: string, channel: string, text: string): Promise<SlackResult<SlackPosted>> {
  // unfurl 끔 — 'aywa에서 열기' 링크가 로그인 화면 미리보기로 부풀지 않게.
  const r = await call<{ channel?: string; ts?: string }>(token, "chat.postMessage", {
    channel,
    text,
    mrkdwn: true,
    unfurl_links: false,
    unfurl_media: false,
  });
  return r.ok ? { ok: true, channel: r.channel ?? channel, ts: r.ts ?? "" } : r;
}

/** 1:1 — 대화방 id를 열어 보낸다. `dmCache`로 한 번의 실행 안에서 같은 사람의 방을 다시 열지 않는다. */
export async function slackPostDm(
  token: string,
  userId: string,
  text: string,
  dmCache?: Map<string, string>,
): Promise<SlackResult<SlackPosted>> {
  let channel = dmCache?.get(userId);
  if (!channel) {
    const r = await call<{ channel?: { id?: string } }>(token, "conversations.open", { users: userId });
    if (!r.ok) return r;
    if (!r.channel?.id) return { ok: false, error: "unknown" };
    channel = r.channel.id;
    dmCache?.set(userId, channel);
  }
  return slackPostMessage(token, channel, text);
}
