/**
 * 벨 알림(classnote_parent_post·classnote_parent_comment) → 학부모 메시지 원문 행(0184a) 찾기 — 순수(서버·클라 공용).
 *
 * 알림 행엔 메시지 id가 없다(워커가 notifications에 제목·본문·링크만 넣는다). 그래서 ① 링크의 글 번호
 * (`/service/report/{id}` — parent-post-filter `classnotePostUrl`)로 그 글의 메시지를 추리고 ② 댓글 알림이면 본문으로 고른다.
 * 알림 본문 규칙 = 워커 `buildNotificationText`·`buildCommentNotificationText`: 앞에 `[사진 1장·파일 1개] ` 같은 첨부 표시,
 * 공백을 한 칸으로 접고, 200자를 넘으면 200자 + "…".
 * 글자 없이 첨부만 있는 글·댓글(2026-10-01~)도 워커가 `[영상] (내용 없이 첨부만)`(알림 본문과 같은 글자)을 원문으로 저장한다 — 영상 숙제 글에도 답글·공감이 서도록.
 * 새 댓글 알림은 링크에 `?comment=<댓글 번호>`가 실려 번호로 정확히 짝짓는다. 번호가 없는 옛 알림만 본문으로 짝짓고,
 * 같은 문구(첨부만 댓글 둘 등)가 둘 이상이면 모호하다(`commentNotificationAmbiguous` — 답글은 같은 글에 달려 무해, 공감은 숨김).
 */

const CLASSNOTE_POST_RE = /\/service\/report\/(\d+)(?:[/?#]|$)/;

export function postIdFromClassnoteLink(link: string | null | undefined): number | null {
  const m = CLASSNOTE_POST_RE.exec(String(link ?? ""));
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** 댓글 알림 링크의 댓글 번호(`?comment=<id>`) — 옛 알림·글 알림은 null. */
export function commentIdFromClassnoteLink(link: string | null | undefined): number | null {
  const m = /[?&]comment=(\d+)(?:[&#]|$)/.exec(String(link ?? ""));
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** 대체 원문(`[영상] (내용 없이 첨부만)`)인가 — 워커 `attachOnlyText`와 같은 글자 모양. */
export function isAttachOnlyContent(content: string | null | undefined): boolean {
  return /^(\[[^\]]*\]\s*)?\(내용 없이 첨부만\)$/.test(collapse(String(content ?? "")));
}

/** 알림 본문이 이 원문에서 만들어졌나. */
export function notificationBodyMatches(notificationBody: string | null | undefined, content: string): boolean {
  const raw = collapse(String(notificationBody ?? ""));
  const text = collapse(content);
  // 첨부만 있는 댓글은 글자 비교가 첨부 표시까지 통째로다("[사진 1장] …"와 "[영상] …"는 다른 댓글).
  if (isAttachOnlyContent(text)) return raw === text;
  const nb = collapse(String(notificationBody ?? "").replace(/^\[[^\]]*\]\s*/, ""));
  if (!nb || !text) return false;
  if (nb.endsWith("…") && text.length > 200) return text.slice(0, 200) === nb.slice(0, -1);
  return text === nb;
}

export type MessageCandidate = { id: string; source: "post" | "comment"; classnotePostId: number; classnoteCommentId: number | null; content: string; postedAt?: string | null };
type NotificationLike = { type: string; link: string | null; body: string | null; /** 알림이 만들어진 때 — 옛 알림의 본문 짝짓기에서 그 뒤에 쓴 댓글을 뺀다 */ createdAt?: string | null };

/** 알림 시각과 ClassNote 시각의 어긋남 여유 — 알림은 댓글을 읽은 **뒤**에 만들어진다. */
const CLOCK_SKEW_MS = 60_000;
/**
 * 이 댓글이 그 알림보다 먼저 쓰였나(둘 중 하나라도 모르면 true — 종전처럼 본다).
 * 옛 알림(번호 없음)은 본문으로만 짝지어서, 알림 **뒤에** 같은 글에 같은 표시의 첨부만 댓글이 저장되면 그 댓글을 집는다
 * (옛 댓글은 저장 전이라 없다) — 그러면 공감이 학부모가 알림을 받은 적 없는 다른 댓글에 눌린다. 알림 뒤에 쓴 댓글은 후보가 아니다.
 */
function postedBeforeNotice(m: MessageCandidate, n: NotificationLike): boolean {
  const posted = m.postedAt ? Date.parse(m.postedAt) : NaN;
  const noticed = n.createdAt ? Date.parse(n.createdAt) : NaN;
  return !Number.isFinite(posted) || !Number.isFinite(noticed) || posted <= noticed + CLOCK_SKEW_MS;
}

/** 옛 알림(댓글 번호 없음)이 본문으로 맞을 수 있는 그 글의 학부모 댓글들. */
function oldCommentHits(n: NotificationLike, postId: number, messages: MessageCandidate[]): MessageCandidate[] {
  return messages.filter((m) => m.classnotePostId === postId && m.source === "comment" && notificationBodyMatches(n.body, m.content) && postedBeforeNotice(m, n));
}

/** 알림 하나에 맞는 메시지 id. 같은 글에 같은 말의 댓글이 둘이면 최근 것(어느 쪽이든 같은 글에 달린다). */
export function pickMessageForNotification(n: NotificationLike, messages: MessageCandidate[]): string | null {
  const postId = postIdFromClassnoteLink(n.link);
  if (!postId) return null;
  const same = messages.filter((m) => m.classnotePostId === postId);
  if (n.type === "classnote_parent_post") return same.find((m) => m.source === "post")?.id ?? null;
  if (n.type !== "classnote_parent_comment") return null;
  // 새 알림 = 링크의 댓글 번호로 정확히 — 그 댓글이 저장돼 있으면 본문 비교는 하지 않는다. 저장이 없으면(번호만 있고 행이 없다) 짝이 없다고 본다.
  const cid = commentIdFromClassnoteLink(n.link);
  if (cid !== null) return same.find((m) => m.source === "comment" && m.classnoteCommentId === cid)?.id ?? null;
  const hits = oldCommentHits(n, postId, same).sort((a, b) => (b.classnoteCommentId ?? 0) - (a.classnoteCommentId ?? 0));
  return hits[0]?.id ?? null;
}

/**
 * 댓글 알림이 같은 글의 **여러** 학부모 댓글에 맞는가(같은 문구의 댓글이 둘 — "감사합니다" 등).
 * 답글은 어느 쪽이든 같은 글에 달려 무해하지만, **공감은 댓글 단위**라 옛 알림에서 눌러도 최근 댓글에 눌린다 — 이런 알림엔 벨의 공감 버튼을 세우지 않는다
 * (수업보고서 '학부모 글·답글' 면에서는 댓글마다 줄이 따로라 그대로 누른다).
 */
export function commentNotificationAmbiguous(n: NotificationLike, messages: MessageCandidate[]): boolean {
  if (n.type !== "classnote_parent_comment") return false;
  const postId = postIdFromClassnoteLink(n.link);
  if (!postId) return false;
  if (commentIdFromClassnoteLink(n.link) !== null) return false; // 번호로 짝지었다 — 모호하지 않다
  return oldCommentHits(n, postId, messages).length > 1;
}

export const PARENT_MESSAGE_NOTIFICATION_TYPES = ["classnote_parent_post", "classnote_parent_comment"] as const;
export function isParentMessageNotification(type: string): boolean {
  return (PARENT_MESSAGE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}
