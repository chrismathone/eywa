"use server";

import { getCurrentUser, type CurrentUser } from "@/lib/auth/current-user";
import { isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn, classnoteSendOn } from "@/features/owner/classnote-gate";
import { logAction } from "@/features/audit/server/log";
import { REPLY_BODY_MAX, REPLY_COOLDOWN_SEC, REPLY_MODE, isReplyManager, replyTargetAllowed, validateReplyBody } from "../reply-policy";
import { PARENT_MESSAGE_NOTIFICATION_TYPES, pickMessageForNotification, postIdFromClassnoteLink } from "../notification-match";
import { isMissingReplyTable, liveBodiesOnPost, loadMessage, loadMessagesByPosts, loadRepliesForMessages, replyTableReady, workerAcceptsReplies } from "./reply-data";
import type { ReplyActionResult, ReplyContext } from "../reply-types";
import { decideReplyPermission, toReplyView } from "./reply-permission";
import { changeReply } from "./reply-change";

/**
 * 학부모 글·댓글 **답글**(0317a) 서버 액션. 입력은 메시지 행 id + 본문(+ 재클릭 키)뿐 — 글·원아·보드는 서버가 DB로 다시 찾는다.
 * 게이트: 로그인·학생 아님 → ClassNote 모듈 → (요청 시) 발송 스위치·모드·열람 전용·자격 → 연동 PC → 본문·쿨다운 → 감사로그.
 * 🔴 모듈이 꺼진 학원은 없는 기능이다(버튼·액션 모두). 표가 없으면(0317a 전) 버튼을 그리지 않는다([[#95]]).
 */

type Gate = { ok: true; user: CurrentUser; manager: boolean; sendOn: boolean } | { ok: false; error: string };

/** `needManager: false` = 관리자급 판정이 필요 없는 조회(벨 버튼 목록) — 보호된 계정 조회를 아낀다(벨은 전원이 매일 여는 자리다). */
async function gate(needManager = true): Promise<Gate> {
  const user = await getCurrentUser();
  if (!user || user.systemRole === "student") return { ok: false, error: "사용할 수 없는 기능입니다" };
  const settings = await getTenantSettings();
  if (!classnoteModuleOn(settings)) return { ok: false, error: "사용할 수 없는 기능입니다" };
  // 관리자급 = 원장·관리자·매니저 + 보호된 계정(새 게이트는 그 계정을 자동 통과시킨다 — decisions/staff.md). 요청 캐시라 한 번만 묻는다.
  const manager = isReplyManager(user.systemRole) || (needManager && (await isCurrentUserSuperAdmin().catch(() => false)));
  return { ok: true, user, manager, sendOn: classnoteSendOn(settings) };
}

/** 벨 목록의 학부모 글·댓글 알림 중 답글을 쓸 수 있는 것 → { 알림 id: 메시지 id }. 자격은 창을 열 때 본다. */
export async function getReplyTargetsForNotifications(notificationIds: string[]): Promise<Record<string, string>> {
  const g = await gate(false);
  // 발송 스위치가 꺼져 있으면 버튼을 세우지 않는다(눌러도 "보낼 수 없습니다"뿐인 버튼 — 벨은 전원이 매일 여는 자리다).
  if (!g.ok || !g.sendOn || REPLY_MODE === "off" || !Array.isArray(notificationIds) || !notificationIds.length) return {};
  const ids = notificationIds.filter((x) => typeof x === "string").slice(0, 100);
  const supabase = await createClient(); // RLS = 내 알림만
  const { data: notes } = await supabase.from("notifications").select("id, type, link, body").in("id", ids).in("type", [...PARENT_MESSAGE_NOTIFICATION_TYPES]);
  const postIds = (notes ?? []).map((n) => postIdFromClassnoteLink(n.link as string | null)).filter((x): x is number => x !== null);
  if (!postIds.length) return {};
  const admin = createAdminClient();
  try {
    if (!(await replyTableReady(admin, g.user.tenantId))) return {}; // 0317a 전 = 버튼 없음
    const messages = await loadMessagesByPosts(admin, g.user.tenantId, postIds);
    const out: Record<string, string> = {};
    for (const n of notes ?? []) {
      const mid = pickMessageForNotification({ type: n.type as string, link: n.link as string | null, body: n.body as string | null }, messages);
      const m = mid ? messages.find((x) => x.id === mid) : null;
      if (m && replyTargetAllowed(REPLY_MODE, { boardName: m.boardName, childId: m.childId }).ok) out[n.id as string] = m.id;
    }
    return out;
  } catch {
    return {};
  }
}

export async function getParentReplyContext(messageId: string): Promise<ReplyContext> {
  const g = await gate();
  if (!g.ok) return g;
  const admin = createAdminClient();
  try {
    const message = await loadMessage(admin, g.user.tenantId, String(messageId));
    if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
    const [replies, perm, workerReady, readonly] = await Promise.all([
      loadRepliesForMessages(admin, g.user.tenantId, [message.id]),
      decideReplyPermission(admin, { user: g.user, manager: g.manager, message, sendOn: g.sendOn }),
      workerAcceptsReplies(admin, g.user.tenantId),
      readonlyTeacherViewError(), // '다른 강사 뷰'(열람 전용) — 수정·삭제 버튼도 세우지 않는다(서버 액션이 어차피 거절한다)
    ]);
    return {
      ok: true,
      message: { id: message.id, source: message.source, content: message.content, boardName: message.boardName, postedAt: message.postedAt },
      replies: replies.map((r) => toReplyView(r, g.user, g.manager)).map((r) => (readonly ? { ...r, canChange: false } : r)),
      canReply: perm.canReply && workerReady,
      reason: perm.reason ?? (workerReady ? null : "연동 PC가 꺼져 있거나 옛 버전이라 지금 답글을 받을 수 없습니다"),
      authorLabel: perm.authorLabel,
      workerReady,
      maxLength: REPLY_BODY_MAX,
    };
  } catch (e) {
    if (isMissingReplyTable(e)) return { ok: false, error: "사용할 수 없는 기능입니다" };
    console.error("[classnote-reply] 불러오기 실패", e);
    return { ok: false, error: "답글 정보를 불러오지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }
}

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,80}$/;
const SAME_BODY = "같은 글에 같은 내용의 답글이 이미 있습니다";

/** 새 답글 요청 — 같은 키로 다시 누르면(재클릭) 그 행 그대로, 같은 글·같은 본문이 살아 있으면 거절. */
export async function requestParentReply(input: { messageId: string; body: string; clientKey: string }): Promise<ReplyActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  if (!CLIENT_KEY.test(String(input?.clientKey ?? ""))) return { ok: false, error: "잘못된 요청입니다 — 창을 닫고 다시 여세요" };
  const v = validateReplyBody(input?.body);
  if (!v.ok) return { ok: false, error: v.error };
  const admin = createAdminClient();
  const tenantId = g.user.tenantId;
  const message = await loadMessage(admin, tenantId, String(input.messageId)).catch(() => null);
  if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
  const perm = await decideReplyPermission(admin, { user: g.user, manager: g.manager, message, sendOn: g.sendOn });
  if (!perm.canReply) return { ok: false, error: perm.reason };
  if (!(await workerAcceptsReplies(admin, tenantId))) return { ok: false, error: "연동 PC가 꺼져 있거나 옛 버전이라 지금 답글을 받을 수 없습니다" };
  // 쿨다운 — 같은 사람이 같은 글에 방금 썼으면(재클릭은 아래 client_key가 먼저 받는다).
  const since = new Date(Date.now() - REPLY_COOLDOWN_SEC * 1000).toISOString();
  const { data: recent } = await admin.from("classnote_parent_replies").select("id, client_key").eq("tenant_id", tenantId)
    .eq("classnote_post_id", message.classnotePostId).eq("author_user_id", g.user.id).gte("created_at", since);
  if ((recent ?? []).some((r) => r.client_key !== input.clientKey)) return { ok: false, error: `방금 이 글에 답글을 요청했습니다 — ${REPLY_COOLDOWN_SEC}초 뒤 다시 쓸 수 있습니다` };
  // 다른 답글이 **이 본문으로 고쳐지는 중**이면 받지 않는다(본문 유니크는 수정 대기 본문을 모른다 — 반영 뒤 기록이 걸린다).
  const live = await liveBodiesOnPost(admin, tenantId, message.classnotePostId).catch(() => []);
  if (live.some((o) => o.pendingBody === v.body)) return { ok: false, error: SAME_BODY };

  const { data, error } = await admin.from("classnote_parent_replies").insert({
    tenant_id: tenantId, message_id: message.id, classnote_post_id: message.classnotePostId,
    reply_to_comment_id: message.source === "comment" ? message.classnoteCommentId : null,
    board_id: perm.boardId, board_name: message.boardName, child_id: message.childId, student_id: perm.studentId,
    author_user_id: g.user.id, author_label: perm.authorLabel, body: v.body, client_key: input.clientKey, last_action_by: g.user.id,
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      // 어느 유니크에 걸렸는지 오류 문구로 가르지 않는다 — 같은 키의 행을 **직접 읽어** 판정한다.
      const { data: mine } = await admin.from("classnote_parent_replies").select("id, body, message_id").eq("tenant_id", tenantId).eq("client_key", input.clientKey).maybeSingle();
      if (!mine) return { ok: false, error: SAME_BODY };
      // 같은 키 + 같은 본문 = 재클릭(그 행 그대로). 본문이 다르면 앞서 보낸 것이 이미 접수된 것이다 — "보냈다"고 답하면
      // 화면은 새 글이 나간 줄 알고 입력을 비우는데 실제로 나가는 건 옛 글이다.
      if (mine.body === v.body && mine.message_id === message.id) return { ok: true, message: "이미 요청한 답글입니다", context: await getParentReplyContext(message.id) };
      return { ok: false, error: "앞서 보낸 답글이 이미 접수됐습니다 — 위 목록에서 확인하고, 내용을 바꾸려면 그 답글을 '수정'하세요" };
    }
    if (isMissingReplyTable(error)) return { ok: false, error: "사용할 수 없는 기능입니다" };
    console.error("[classnote-reply] 요청 실패", error);
    return { ok: false, error: "답글을 요청하지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }
  await logAction({
    action: "classnote_parent_reply_request",
    targetType: "classnote_parent_reply",
    targetLabel: `학부모 ${message.source === "comment" ? "댓글" : "글"}에 답글(${message.boardName ?? "보드 미상"})`,
    metadata: { replyId: data?.id ?? null, messageId: message.id, postId: message.classnotePostId, author: perm.authorLabel, length: v.body.length, manager: g.manager },
  });
  return { ok: true, message: "요청했습니다 — 연동 PC가 곧 ClassNote에 올립니다", context: await getParentReplyContext(message.id) };
}

/** 답글 수정(본인 또는 관리자급). 올리기 전이면 바로 고치고, 게시됐으면 연동 PC가 ClassNote 댓글을 고친다. */
export async function requestParentReplyEdit(input: { replyId: string; body: string }): Promise<ReplyActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await changeReply({ user: g.user, manager: g.manager, sendOn: g.sendOn, replyId: String(input?.replyId ?? ""), kind: "edit", body: input?.body });
  return r.ok ? { ok: true, message: r.message, context: await getParentReplyContext(r.messageId) } : r;
}

/** 답글 삭제(본인 또는 관리자급). 올리기 전이면 바로 취소하고, 게시됐으면 연동 PC가 ClassNote 댓글을 지운다. */
export async function requestParentReplyDelete(input: { replyId: string }): Promise<ReplyActionResult> {
  const g = await gate();
  if (!g.ok) return g;
  const r = await changeReply({ user: g.user, manager: g.manager, sendOn: g.sendOn, replyId: String(input?.replyId ?? ""), kind: "delete" });
  return r.ok ? { ok: true, message: r.message, context: await getParentReplyContext(r.messageId) } : r;
}
