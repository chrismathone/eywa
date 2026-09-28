import { jandiEventLabel } from "./events";

/**
 * 잔디 인커밍 웹훅 — 순수 함수(주소 검증·가리기·메시지 조립). 서버·클라·테스트가 함께 쓴다.
 *
 * 잔디 스펙(support.jandi.com 커넥트 문서, 2026-09-28 확인):
 *  · POST `https://wh.jandi.com/connect-api/webhook/{토큰}` · Accept `application/vnd.tosslab.jandi-v2+json`
 *  · 본문 `{ body, connectColor, connectInfo: [{ title, description }] }` · 링크 문법 `[[글자]](url)`
 *  · 메시지는 5,000자까지 표시 · 분당 60회 / 10분 500회(넘으면 429)
 */
export const JANDI_WEBHOOK_PREFIX = "https://wh.jandi.com/connect-api/webhook/";
const JANDI_URL_RE = /^https:\/\/wh\.jandi\.com\/connect-api\/webhook\/[A-Za-z0-9_\-/]{8,200}$/;

/** 한 번의 알림 발송에서 잔디로 낱개로 보낼 최대 메시지 수 — 넘으면 한 통으로 묶는다(분당 60회 한도). */
export const JANDI_MAX_MESSAGES_PER_BATCH = 3;
/** 묶음 메시지에 펼쳐 적는 최대 항목 수(나머지는 "외 N건"). */
const DIGEST_MAX_ITEMS = 10;
const MAX_FIELD = 600;
const COLOR = "#1F3A68";

export type JandiUrlCheck = { ok: true; url: string } | { ok: false; error: string };

export function checkJandiWebhookUrl(raw: string): JandiUrlCheck {
  const url = raw.trim();
  if (!url) return { ok: false, error: "웹훅 주소를 붙여 넣어 주세요" };
  if (!url.startsWith(JANDI_WEBHOOK_PREFIX)) {
    return { ok: false, error: `잔디 인커밍 웹훅 주소가 아닙니다 — ${JANDI_WEBHOOK_PREFIX} 로 시작해야 합니다` };
  }
  if (!JANDI_URL_RE.test(url)) return { ok: false, error: "웹훅 주소 모양이 올바르지 않습니다" };
  return { ok: true, url };
}

/** 화면 표시용 — 토큰 끝 4자만 남긴다(주소 자체가 비밀번호라 원문을 클라에 내려보내지 않는다). */
export function maskJandiWebhookUrl(url: string): string {
  if (!url) return "";
  const tail = url.slice(-4);
  return `${JANDI_WEBHOOK_PREFIX}••••${tail}`;
}

export type ForwardRow = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  recipientId: string;
};

export type JandiMessage = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  recipientIds: string[];
};

/**
 * 고른 종류만 남기고, 같은 알림(종류·제목·본문·링크)이 여러 사람에게 간 것은 한 통으로 합친다.
 * (알림은 받는 사람마다 한 행이지만 잔디 방은 하나라 그대로 보내면 같은 글이 N번 올라간다.)
 */
export function planJandiMessages(rows: readonly ForwardRow[], enabled: ReadonlySet<string>): JandiMessage[] {
  const byKey = new Map<string, JandiMessage>();
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

export type JandiPayload = {
  body: string;
  connectColor: string;
  connectInfo: { title: string; description: string }[];
};

const clip = (s: string, n = MAX_FIELD) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function absoluteLink(link: string | null, appUrl: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  if (!appUrl || !link.startsWith("/")) return null;
  return `${appUrl}${link}`;
}

/** 잔디 링크 문법의 글자 칸을 깨뜨리는 대괄호를 치운다. */
const safeText = (s: string) => s.replace(/[[\]]/g, " ").trim();

export function buildSinglePayload(
  m: JandiMessage,
  recipientNames: readonly string[],
  appUrl: string | null,
): JandiPayload {
  const href = absoluteLink(m.link, appUrl);
  const head = `[${jandiEventLabel(m.type)}] ${safeText(m.title)}`;
  const info: JandiPayload["connectInfo"] = [];
  if (m.body) info.push({ title: "내용", description: clip(m.body) });
  if (recipientNames.length > 0) info.push({ title: "받는 사람", description: clip(recipientNames.join(", ")) });
  return {
    body: clip(href ? `${head} · [[aywa에서 열기]](${href})` : head, 1000),
    connectColor: COLOR,
    connectInfo: info,
  };
}

/** 한 번에 알림이 많이 생기면(일괄 배정 등) 낱개 대신 한 통으로 묶는다. */
export function buildDigestPayload(messages: readonly JandiMessage[]): JandiPayload {
  const shown = messages.slice(0, DIGEST_MAX_ITEMS);
  const info = shown.map((m) => ({
    title: clip(`[${jandiEventLabel(m.type)}] ${safeText(m.title)}`, 200),
    description: clip(m.body ?? "", 300),
  }));
  const rest = messages.length - shown.length;
  if (rest > 0) info.push({ title: `외 ${rest}건`, description: "나머지는 aywa 알림에서 확인해 주세요." });
  return { body: `[aywa] 알림 ${messages.length}건`, connectColor: COLOR, connectInfo: info };
}

/** 발송 실패를 사람이 읽을 한글로 — 잔디 오류코드(40000·42900)와 네트워크 오류. */
export function describeJandiFailure(status: number | null): string {
  if (status === null) return "잔디 서버에 연결하지 못했습니다(시간 초과 또는 네트워크 오류)";
  if (status === 429) return "잔디 발송 한도(분당 60회)를 넘었습니다. 잠시 후 다시 시도해 주세요";
  if (status === 400 || status === 404) return "잔디가 거절했습니다 — 웹훅이 꺼졌거나 삭제됐거나 주소가 틀렸습니다";
  return `잔디가 오류로 응답했습니다(HTTP ${status})`;
}
