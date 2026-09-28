import { forwardEventLabel, sanitizeForwardEventTypes } from "./events";

/**
 * 슬랙 알림 — 순수 함수(토큰 검증·가리기·보낼 곳 정리·메시지 조립·오류 한글화). 서버·클라·테스트 공용.
 * 슬랙 서식(mrkdwn): `*굵게*` · 링크 `<url|글자>` · `& < >`는 이스케이프해야 한다.
 */

/** 한 번의 알림 발송에서 한 곳(채널·사람)에 낱개로 보낼 최대 메시지 수 — 넘으면 한 통으로 묶는다. */
export const SLACK_MAX_MESSAGES_PER_BATCH = 3;
/** 채널 보낼 곳 상한 — 설정 화면이 끝없이 길어지지 않게. */
export const SLACK_MAX_CHANNEL_ROUTES = 10;
const DIGEST_MAX_ITEMS = 10;
const MAX_BODY = 1500;

const TOKEN_RE = /^xoxb-[0-9A-Za-z-]{20,200}$/;
const CHANNEL_ID_RE = /^[CG][A-Z0-9]{6,20}$/;

export type SlackTokenCheck = { ok: true; token: string } | { ok: false; error: string };

export function checkSlackBotToken(raw: string): SlackTokenCheck {
  const token = raw.trim();
  if (!token) return { ok: false, error: "봇 토큰을 붙여 넣어 주세요" };
  if (!token.startsWith("xoxb-")) return { ok: false, error: "봇 토큰(xoxb-로 시작)이 아닙니다 — 'Bot User OAuth Token'을 복사하세요" };
  if (!TOKEN_RE.test(token)) return { ok: false, error: "봇 토큰 모양이 올바르지 않습니다" };
  return { ok: true, token };
}

/** 화면 표시용 — 끝 4자만(토큰 원문은 클라에 내려보내지 않는다). */
export function maskSlackToken(token: string): string {
  return token ? `xoxb-••••${token.slice(-4)}` : "";
}

// ── 보낼 곳 ──────────────────────────────────────────────────────────
export type SlackRoute =
  | { kind: "dm"; eventTypes: string[] }
  | { kind: "channel"; channelId: string; channelName: string; eventTypes: string[] };

/** 저장 전 정리 — 1:1은 하나만, 채널은 id 모양·중복·상한 확인, 알림 종류는 목록에 있는 것만. */
export function sanitizeSlackRoutes(input: unknown): SlackRoute[] {
  if (!Array.isArray(input)) return [];
  const out: SlackRoute[] = [];
  let dmSeen = false;
  const channelSeen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const eventTypes = sanitizeForwardEventTypes(Array.isArray(r.eventTypes) ? r.eventTypes.map(String) : []);
    if (r.kind === "dm" && !dmSeen) {
      dmSeen = true;
      out.push({ kind: "dm", eventTypes });
    } else if (r.kind === "channel") {
      const channelId = typeof r.channelId === "string" ? r.channelId.trim() : "";
      if (!CHANNEL_ID_RE.test(channelId) || channelSeen.has(channelId)) continue;
      if (channelSeen.size >= SLACK_MAX_CHANNEL_ROUTES) continue;
      channelSeen.add(channelId);
      const channelName = typeof r.channelName === "string" ? r.channelName.slice(0, 80) : "";
      out.push({ kind: "channel", channelId, channelName, eventTypes });
    }
  }
  return out;
}

// ── 메시지 ───────────────────────────────────────────────────────────
export type ForwardRow = { type: string; title: string; body: string | null; link: string | null; recipientId: string };
export type ForwardMessage = { type: string; title: string; body: string | null; link: string | null; recipientIds: string[] };

/** 고른 종류만 남기고, 같은 알림(종류·제목·본문·링크)이 여러 사람에게 간 것은 한 통으로 합친다. */
export function planForwardMessages(rows: readonly ForwardRow[], enabled: ReadonlySet<string>): ForwardMessage[] {
  const byKey = new Map<string, ForwardMessage>();
  for (const r of rows) {
    if (!enabled.has(r.type)) continue;
    const key = [r.type, r.title, r.body ?? "", r.link ?? ""].join("\u0000");
    const hit = byKey.get(key);
    if (hit) {
      if (!hit.recipientIds.includes(r.recipientId)) hit.recipientIds.push(r.recipientId);
    } else {
      byKey.set(key, { type: r.type, title: r.title, body: r.body, link: r.link, recipientIds: [r.recipientId] });
    }
  }
  return [...byKey.values()];
}

export const escapeMrkdwn = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function absoluteLink(link: string | null, appUrl: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  if (!appUrl || !link.startsWith("/")) return null;
  return `${appUrl}${link}`;
}

/** 낱개 한 통. `recipientNames`는 채널에만 준다(1:1은 받는 사람이 곧 본인). */
export function buildSlackText(m: ForwardMessage, appUrl: string | null, recipientNames: readonly string[] = []): string {
  const lines = [`*[${forwardEventLabel(m.type)}] ${escapeMrkdwn(m.title)}*`];
  if (m.body) lines.push(escapeMrkdwn(clip(m.body, MAX_BODY)));
  if (recipientNames.length > 0) lines.push(`받는 사람: ${escapeMrkdwn(clip(recipientNames.join(", "), 300))}`);
  const href = absoluteLink(m.link, appUrl);
  // 링크의 `|`·`>`는 슬랙 링크 문법을 끊는다 — 주소에서 인코딩.
  if (href) lines.push(`<${href.replace(/\|/g, "%7C").replace(/>/g, "%3E")}|aywa에서 열기>`);
  return lines.join("\n");
}

/** 한 번에 알림이 많이 생기면(일괄 배정 등) 한 통으로 묶는다. */
export function buildSlackDigestText(messages: readonly ForwardMessage[]): string {
  const shown = messages.slice(0, DIGEST_MAX_ITEMS);
  const lines = [`*[aywa] 알림 ${messages.length}건*`];
  for (const m of shown) lines.push(`• [${forwardEventLabel(m.type)}] ${escapeMrkdwn(clip(m.title, 200))}`);
  const rest = messages.length - shown.length;
  if (rest > 0) lines.push(`• 외 ${rest}건 — 나머지는 aywa 알림에서 확인해 주세요.`);
  return lines.join("\n");
}

/** 슬랙 오류 코드 → 한글(원문 코드는 화면에 그대로 내지 않는다). null = 네트워크·시간 초과. */
export function describeSlackError(code: string | null): string {
  switch (code) {
    case null:
      return "슬랙 서버에 연결하지 못했습니다(시간 초과 또는 네트워크 오류)";
    case "invalid_auth":
    case "not_authed":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return "슬랙이 토큰을 거절했습니다 — 앱이 삭제·재설치됐거나 토큰이 바뀌었습니다. 새 봇 토큰을 등록해 주세요";
    case "missing_scope":
      return "슬랙 앱 권한이 부족합니다 — 안내된 권한(scope)을 모두 추가하고 앱을 다시 설치해 주세요";
    case "channel_not_found":
    case "not_in_channel":
      return "채널에 보낼 수 없습니다 — 비공개 채널이면 채널에서 /invite 로 앱을 먼저 초대해 주세요";
    case "is_archived":
      return "보관된 채널이라 보낼 수 없습니다";
    case "users_not_found":
      return "슬랙에서 같은 이메일의 사용자를 찾지 못했습니다";
    case "ratelimited":
      return "슬랙 발송 한도를 넘었습니다. 잠시 후 다시 시도해 주세요";
    default:
      return "슬랙이 오류로 응답했습니다";
  }
}
