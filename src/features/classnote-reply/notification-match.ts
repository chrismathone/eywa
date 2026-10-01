/**
 * 벨 알림(classnote_parent_post·classnote_parent_comment) → 학부모 메시지 원문 행(0184a) 찾기 — 순수(서버·클라 공용).
 *
 * 알림 행엔 메시지 id가 없다(워커가 notifications에 제목·본문·링크만 넣는다). 그래서 ① 링크의 글 번호
 * (`/service/report/{id}` — parent-post-filter `classnotePostUrl`)로 그 글의 메시지를 추리고 ② 댓글 알림이면 본문으로 고른다.
 * 알림 본문 규칙 = 워커 `buildNotificationText`·`buildCommentNotificationText`: 앞에 `[사진 1장·파일 1개] ` 같은 첨부 표시,
 * 공백을 한 칸으로 접고, 200자를 넘으면 200자 + "…".
 * ⚠️ 원문이 비어 있는 메시지(사진·스티커만)는 0184a에 저장되지 않는다 → 그런 알림엔 답글 버튼이 없다(찾을 원문이 없다).
 */

const CLASSNOTE_POST_RE = /\/service\/report\/(\d+)(?:[/?#]|$)/;

export function postIdFromClassnoteLink(link: string | null | undefined): number | null {
  const m = CLASSNOTE_POST_RE.exec(String(link ?? ""));
  const id = m ? Number(m[1]) : NaN;
  return Number.isFinite(id) && id > 0 ? id : null;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** 알림 본문이 이 원문에서 만들어졌나. */
export function notificationBodyMatches(notificationBody: string | null | undefined, content: string): boolean {
  const nb = collapse(String(notificationBody ?? "").replace(/^\[[^\]]*\]\s*/, ""));
  const text = collapse(content);
  if (!nb || !text) return false;
  if (nb.endsWith("…") && text.length > 200) return text.slice(0, 200) === nb.slice(0, -1);
  return text === nb;
}

export type MessageCandidate = { id: string; source: "post" | "comment"; classnotePostId: number; classnoteCommentId: number | null; content: string };

/** 알림 하나에 맞는 메시지 id. 같은 글에 같은 말의 댓글이 둘이면 최근 것(어느 쪽이든 같은 글에 달린다). */
export function pickMessageForNotification(
  n: { type: string; link: string | null; body: string | null },
  messages: MessageCandidate[],
): string | null {
  const postId = postIdFromClassnoteLink(n.link);
  if (!postId) return null;
  const same = messages.filter((m) => m.classnotePostId === postId);
  if (n.type === "classnote_parent_post") return same.find((m) => m.source === "post")?.id ?? null;
  if (n.type !== "classnote_parent_comment") return null;
  const hits = same
    .filter((m) => m.source === "comment" && notificationBodyMatches(n.body, m.content))
    .sort((a, b) => (b.classnoteCommentId ?? 0) - (a.classnoteCommentId ?? 0));
  return hits[0]?.id ?? null;
}

/**
 * 댓글 알림이 같은 글의 **여러** 학부모 댓글에 맞는가(같은 문구의 댓글이 둘 — "감사합니다" 등).
 * 답글은 어느 쪽이든 같은 글에 달려 무해하지만, **공감은 댓글 단위**라 옛 알림에서 눌러도 최근 댓글에 눌린다 — 이런 알림엔 벨의 공감 버튼을 세우지 않는다
 * (수업보고서 '학부모 글·답글' 면에서는 댓글마다 줄이 따로라 그대로 누른다).
 */
export function commentNotificationAmbiguous(n: { type: string; link: string | null; body: string | null }, messages: MessageCandidate[]): boolean {
  if (n.type !== "classnote_parent_comment") return false;
  const postId = postIdFromClassnoteLink(n.link);
  if (!postId) return false;
  return messages.filter((m) => m.classnotePostId === postId && m.source === "comment" && notificationBodyMatches(n.body, m.content)).length > 1;
}

export const PARENT_MESSAGE_NOTIFICATION_TYPES = ["classnote_parent_post", "classnote_parent_comment"] as const;
export function isParentMessageNotification(type: string): boolean {
  return (PARENT_MESSAGE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}
