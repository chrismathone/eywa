import type { ReplyView, ThreadEntry, ThreadPhoto, ThreadVideo } from "./reply-types";
import { hasVideoMarker, markerPhotoCount, MEDIA_LOCKED_TEXT, PHOTO_NOT_LISTED_TEXT, VIDEO_NOT_LISTED_TEXT } from "./thread-video";

/**
 * 쓰레드 조립(순수) — 한 글의 학부모 원문·댓글과 우리 답글을 **시간순 한 줄기**로. 같은 시각이면 학부모 글이 먼저다.
 * 🔴 호출부(서버)가 "이 글을 볼 자격"을 이미 통과시킨 뒤 넘긴다 — 같은 글(postId)·같은 원아의 메시지만 넘길 것.
 */
export type ThreadMessage = { id: string; source: "post" | "comment"; classnoteCommentId: number | null; content: string; postedAt: string | null; createdAt?: string | null };
export type ThreadReply = { view: ReplyView; messageId: string | null };

const at = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function composeThread(a: {
  focusId: string;
  messages: ThreadMessage[];
  replies: ThreadReply[];
  /** 메시지 id → 그 글·댓글의 영상 */
  videosOf: (m: ThreadMessage) => ThreadVideo[];
  /** 메시지 → 그 글·댓글의 사진 */
  photosOf: (m: ThreadMessage) => ThreadPhoto[];
  /** 영상·사진 열람 자격(false면 있어도 안내 문구만) */
  canWatch: boolean;
  /** 열람 불가일 때 기본 문구 대신 쓸 이유(학생 미확정 등) */
  lockedNote?: string;
}): ThreadEntry[] {
  const parents = a.messages.map((m) => {
    const videos = a.videosOf(m);
    const photos = a.photosOf(m);
    const missingVideo = !videos.length && hasVideoMarker(m.content);
    const missingPhoto = !photos.length && markerPhotoCount(m.content) > 0;
    const mediaNote = missingVideo || missingPhoto
      ? (!a.canWatch ? (a.lockedNote ?? MEDIA_LOCKED_TEXT) : missingVideo ? VIDEO_NOT_LISTED_TEXT : PHOTO_NOT_LISTED_TEXT)
      : null;
    return { t: at(m.postedAt ?? m.createdAt), rank: 0, entry: { kind: "parent", messageId: m.id, source: m.source, content: m.content, postedAt: m.postedAt, focus: m.id === a.focusId, videos, photos, mediaNote } as ThreadEntry };
  });
  const replies = a.replies.map((r) => ({ t: at(r.view.createdAt), rank: 1, entry: { kind: "reply", reply: r.view, messageId: r.messageId } as ThreadEntry }));
  return [...parents, ...replies].sort((x, y) => x.t - y.t || x.rank - y.rank).map((x) => x.entry);
}
