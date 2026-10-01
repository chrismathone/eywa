import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getStudentById } from "@/features/students/server/queries";
import { fetchInChunks } from "@/lib/supabase/batch";
import type { ReplyView, ThreadEntry, ThreadPhoto, ThreadVideo } from "../reply-types";
import { composeThread, type ThreadMessage } from "../thread-compose";
import { MEDIA_REPLY_ONLY_TEXT, NO_STUDENT_TEXT, toThreadVideo, videoBelongsToThread, type VideoRow } from "../thread-video";
import { loadMessagesByPosts, loadRepliesForPost, type ParentMessage } from "./reply-data";
import { toReplyView } from "./reply-permission";

/**
 * 답글 창의 쓰레드(원문 · 같은 글의 학부모 댓글 · 우리 답글 · 영상) — 서버 조립.
 * 🔴 이 함수는 호출부가 **그 글에 답글을 쓸 자격**(`decideReplyPermission` canReply)을 확인한 뒤에만 부른다. 같은 글(postId)이라도
 * **같은 원아**의 메시지만 싣고(다른 원아 글이 섞이지 않게), 영상 주소는 학생 '숙제 영상' 탭과 **같은 게이트**(students 메뉴 접근 +
 * `getStudentById` — 강사는 담당 학생만)를 통과한 사람에게만 내려보낸다(#77 — 화면 조건은 게이트가 아니다).
 */
type Admin = ReturnType<typeof createAdminClient>;

/**
 * 이 학생의 영상·사진을 볼 수 있나 — 학생 상세 '숙제 영상' 탭(`getStudentHomeworkVideos`)과 **같은 두 문**: students 메뉴 접근 +
 * `getStudentById`(지점·담당 학생 판정 `canViewStudentDetail` + 사용자 RLS로 그 학생 행이 보이는가). 학생을 모르면 못 본다.
 */
export async function canWatchThreadVideos(user: CurrentUser, studentId: string | null): Promise<boolean> {
  if (!studentId) return false;
  try {
    if (!(await canAccessTenant(user.systemRole, "students"))) return false;
    return (await getStudentById(studentId)) !== null;
  } catch {
    return false; // 판정 실패 = 못 본다(열어 두지 않는다)
  }
}

/**
 * 쓰레드 범위 — 같은 글(ClassNote 글 번호)·**같은 원아**의 학부모 글·댓글. 원아를 모르는 글은 그 글 하나뿐(다른 가정 댓글·영상이 섞이지 않게).
 * 답글 창 조립(`buildThread`)과 영상 상태 폴링(`getThreadVideoStates`)이 **같은 함수**로 범위를 정한다(두 곳이 갈라지면 폴링이 다른 영상을 덮는다).
 * `childKnown` = 학생 미확정 영상 행(워커가 아직 학생을 못 적은 것)도 이 글의 것으로 볼 수 있나 — ClassNote 글은 원아 하나의 것이라 그 글 번호의 영상은 그 원아 가정의 것이다.
 */
export function threadScope(all: ParentMessage[], focus: ParentMessage): { messages: ParentMessage[]; childKnown: boolean } {
  const childKnown = focus.childId != null;
  const same = childKnown ? all.filter((m) => m.id !== focus.id && m.classnotePostId === focus.classnotePostId && m.childId === focus.childId) : [];
  return { messages: [focus, ...same], childKnown };
}

const VIDEO_COLS = "id, comment_id, status, drive_file_id, uploaded_at, student_id";
type VideoDbRow = VideoRow & { comment_id: number | null; student_id: string | null };

/** 그 글(post_id)에 붙은 영상 행 — 표가 없으면(0315a 전·옛 DB) 빈 목록. 다른 학생에 묶인 영상은 버린다(학생을 못 정한 행은 이 글의 것). */
async function loadPostVideos(admin: Admin, tenantId: string, postId: number, studentId: string | null, allowUnmatched: boolean): Promise<VideoDbRow[]> {
  const { data, error } = await admin.from("student_homework_videos").select(VIDEO_COLS).eq("tenant_id", tenantId).eq("post_id", postId).order("created_at").limit(50);
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return [];
    throw error;
  }
  return ((data ?? []) as unknown as VideoDbRow[]).filter((r) => videoBelongsToThread(r.student_id, { studentId, allowUnmatched }));
}

type VideoArgs = { tenantId: string; postId: number; studentId: string | null; messages: ParentMessage[]; /** 학생 미확정 영상 행도 이 글의 것으로 보나 — `threadScope().childKnown`(원아를 아는 글)만 */ allowUnmatched?: boolean };

/** 게이트를 통과한 뒤에만 부른다 — 메시지 id → 그 글·댓글의 영상(화면 모델). 글 = comment_id 없는 영상, 댓글 = 그 댓글 번호의 영상. */
async function videosByMessage(admin: Admin, a: VideoArgs): Promise<Map<string, ThreadVideo[]>> {
  const byMessage = new Map<string, ThreadVideo[]>();
  const [rows, teacherView] = await Promise.all([loadPostVideos(admin, a.tenantId, a.postId, a.studentId, a.allowUnmatched === true).catch(() => []), effectiveTeacherId().catch(() => null)]);
  for (const m of a.messages) {
    const mine = rows.filter((r) => (m.source === "post" ? r.comment_id == null : r.comment_id != null && Number(r.comment_id) === m.classnoteCommentId));
    if (mine.length) byMessage.set(m.id, mine.map((r) => toThreadVideo(r, { canView: true, showDriveLink: !teacherView })));
  }
  return byMessage;
}

/** 열람 게이트 + 영상 — 영상 상태 폴링(`getThreadVideoStates`)이 쓴다. 게이트를 못 넘으면 빈 지도(주소 0). */
export async function loadThreadVideos(admin: Admin, a: VideoArgs & { user: CurrentUser }): Promise<{ byMessage: Map<string, ThreadVideo[]>; canWatch: boolean }> {
  const canWatch = await canWatchThreadVideos(a.user, a.studentId);
  return { byMessage: canWatch ? await videosByMessage(admin, a) : new Map<string, ThreadVideo[]>(), canWatch };
}

/**
 * 메시지 id → 사진 주소(0326a 서버 전용 표). 표가 없거나(SQL 전) 읽기가 실패하면 사진 없이 간다 — 쓰레드·영상·답글은 그대로 열려야 한다(#95).
 * 🔴 주소는 호출부가 영상과 같은 열람 게이트(`canWatchThreadVideos`)를 통과시킨 뒤에만 부른다.
 */
async function loadThreadPhotos(admin: Admin, tenantId: string, messageIds: string[]): Promise<Map<string, ThreadPhoto[]>> {
  const out = new Map<string, ThreadPhoto[]>();
  if (!messageIds.length) return out;
  try {
    const rows = await fetchInChunks<{ message_id: string; attachments: unknown }>(messageIds, (chunk) =>
      admin.from("classnote_parent_message_attachments").select("message_id, attachments").eq("tenant_id", tenantId).in("message_id", chunk),
    );
    for (const r of rows) out.set(r.message_id, sanitizePhotos(r.attachments));
  } catch {
    /* 표 없음·읽기 실패 — 사진만 빠진다 */
  }
  return out;
}

/** 저장된 jsonb → 화면용 사진(https 주소만 · 모양이 이상한 항목은 버린다). 읽는 쪽에서도 한 번 더 거른다. */
export function sanitizePhotos(raw: unknown): ThreadPhoto[] {
  const https = (v: unknown) => {
    try {
      const u = typeof v === "string" ? new URL(v) : null;
      return u && u.protocol === "https:" && /(^|\.)(kakao\.com|kakaocdn\.net)$/i.test(u.hostname) ? u.href : null;
    } catch {
      return null;
    }
  };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
  return (Array.isArray(raw) ? raw : []).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const large = https(o.large);
    const small = https(o.small) ?? large;
    return large && small ? [{ small, large, width: num(o.width), height: num(o.height) }] : [];
  }).slice(0, 10);
}

/**
 * 쓰레드 한 벌. `focus` = 지금 답글·공감을 다는 글. 같은 글·같은 원아의 학부모 글·댓글 + 그 글의 모든 답글(삭제된 것 포함 — 상태 라벨로).
 */
export async function buildThread(admin: Admin, a: { user: CurrentUser; manager: boolean; focus: ParentMessage; studentId: string | null }): Promise<ThreadEntry[]> {
  const tenantId = a.user.tenantId;
  // 열람 게이트는 학생만 알면 되니 원문·답글 조회와 같이 띄운다(B4).
  const [all, replyRows, canWatch] = await Promise.all([
    loadMessagesByPosts(admin, tenantId, [a.focus.classnotePostId]),
    loadRepliesForPost(admin, tenantId, a.focus.classnotePostId),
    canWatchThreadVideos(a.user, a.studentId),
  ]);
  // 🔴 원아가 확정된 글만 같은 원아의 댓글까지 묶는다 — 원아를 모르는 글은 그 글 하나뿐(threadScope).
  const { messages: sameThread, childKnown } = threadScope(all, a.focus);
  const [byMessage, photos] = canWatch
    ? await Promise.all([
        videosByMessage(admin, { tenantId, postId: a.focus.classnotePostId, studentId: a.studentId, messages: sameThread, allowUnmatched: childKnown }),
        loadThreadPhotos(admin, tenantId, sameThread.map((m) => m.id)),
      ])
    : [new Map<string, ThreadVideo[]>(), new Map<string, ThreadPhoto[]>()];
  const ids = new Set(sameThread.map((m) => m.id));
  const messages: ThreadMessage[] = sameThread.map((m) => ({ id: m.id, source: m.source, classnoteCommentId: m.classnoteCommentId, content: m.content, postedAt: m.postedAt }));
  // 답글은 메시지에 묶인 것만(message_id가 이 쓰레드의 글·댓글) — 글에 묶였는데 메시지가 지워진 행(message_id null)은 같은 글이라 함께 싣는다.
  const replies = replyRows.filter((r) => !r.messageId || ids.has(r.messageId)).map((r): { view: ReplyView; messageId: string | null } => ({ view: toReplyView(r, a.user, a.manager), messageId: r.messageId }));
  return composeThread({ focusId: a.focus.id, messages, replies, videosOf: (m) => byMessage.get(m.id) ?? [], photosOf: (m) => photos.get(m.id) ?? [], canWatch, lockedNote: a.studentId ? undefined : NO_STUDENT_TEXT });
}

/** 답글을 쓸 자격이 없는 사람에게 — 그 글 하나와 그 글의 답글뿐(같은 글의 다른 댓글·영상은 싣지 않는다). 종전 화면과 같은 범위다. */
export async function buildMinimalThread(admin: Admin, a: { user: CurrentUser; manager: boolean; focus: ParentMessage }): Promise<ThreadEntry[]> {
  const rows = await loadRepliesForPost(admin, a.user.tenantId, a.focus.classnotePostId);
  const m = a.focus;
  return composeThread({
    focusId: m.id,
    messages: [{ id: m.id, source: m.source, classnoteCommentId: m.classnoteCommentId, content: m.content, postedAt: m.postedAt }],
    replies: rows.filter((r) => r.messageId === m.id).map((r) => ({ view: toReplyView(r, a.user, a.manager), messageId: r.messageId })),
    videosOf: () => [],
    photosOf: () => [],
    canWatch: false,
    lockedNote: MEDIA_REPLY_ONLY_TEXT, // 권한 문구가 아니다 — 관리자에게 "관리자만"이라고 말하지 않게
  });
}
