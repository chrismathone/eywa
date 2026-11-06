"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { logAction } from "@/features/audit/server/log";
import { REPLY_BODY_MAX, REPLY_COOLDOWN_SEC, replyBoardKnown, replyTargetAllowed, validateReplyBody } from "../reply-policy";
import { PARENT_MESSAGE_NOTIFICATION_TYPES, commentNotificationAmbiguous, pickMessageForNotification, postIdFromClassnoteLink } from "../notification-match";
import {
  isMissingReplyTable, liveBodiesOnPost, loadMessage, loadMessagesByPosts, loadRepliesForMessages, replyTableReady, uniqueClassBoardNames, workerAcceptsReplies, type ParentMessage,
} from "./reply-data";
import type { ReactionView, ReplyActionResult, ReplyContext, ReplyTargets } from "../reply-types";
import { decideReplyPermission, type PermissionMemo } from "./reply-permission";
import { buildMinimalThread, buildThread } from "./thread-data";
import { changeReply } from "./reply-change";
import { replyGate, replyNotificationScope } from "./reply-gate";
import { classnoteLinkForHomeroom } from "./classnote-link";
import { loadReaction, loadReactions, reactionReady, toReactionView } from "./reaction-data";

/**
 * 학부모 글·댓글 **답글**(0317a) 서버 액션. 입력은 메시지 행 id + 본문(+ 재클릭 키)뿐 — 글·원아·보드는 서버가 DB로 다시 찾는다.
 * 게이트: 로그인·학생 아님 → 모드(학원 설정 — 끔이면 없는 기능) → (요청 시) 발송 스위치·열람 전용·자격·대상 확정 → 연동 PC → 본문·쿨다운 → 감사로그.
 * 🔴 모드가 끔이거나 모듈이 꺼진 학원은 없는 기능이다(버튼·면·액션 모두). 표가 없으면(0317a 전) 버튼을 그리지 않는다([[#95]]).
 */

/** 벨이 자격까지 판정해 주는 알림 수 상한(전체 모드·강사) — 넘는 알림은 버튼 없이 둔다(면·ClassNote에서 답한다). */
const BELL_PERMISSION_CAP = 30;

/**
 * 벨 목록의 학부모 글·댓글 알림 중 답글·공감을 쓸 수 있는 것 → { 알림 id: 메시지 id } + 그 메시지들의 공감 상태.
 *   시험 = 학원이 테스트 보드의 글만 · 전체 = **답글 자격이 있는 글만**(관리자급은 전부, 그 밖은 그 학생을 지금 맡은 사람 — 벨 수신자와 같은 규칙).
 */
export async function getReplyTargetsForNotifications(notificationIds: string[]): Promise<ReplyTargets> {
  const none: ReplyTargets = { targets: {}, reactions: null, vague: [], counts: {} };
  const g = await replyGate(false);
  // 발송 스위치가 꺼져 있으면 버튼을 세우지 않는다(눌러도 "보낼 수 없습니다"뿐인 버튼 — 벨은 전원이 매일 여는 자리다).
  if (!g.ok || !g.sendOn || !Array.isArray(notificationIds) || !notificationIds.length) return none;
  const ids = notificationIds.filter((x) => typeof x === "string").slice(0, 100);
  // 내 알림만 — 평소엔 세션(RLS), '다른 강사 뷰'면 대상 직원의 알림까지(지점·받는 사람 명시, replyNotificationScope).
  const scope = await replyNotificationScope(g.user);
  const { data: notes } = await scope.db.from("notifications").select("id, type, link, body, created_at")
    .eq("tenant_id", g.user.tenantId).in("recipient_id", scope.recipients).in("id", ids).in("type", [...PARENT_MESSAGE_NOTIFICATION_TYPES]);
  const postIds = (notes ?? []).map((n) => postIdFromClassnoteLink(n.link as string | null)).filter((x): x is number => x !== null);
  if (!postIds.length) return none;
  const admin = createAdminClient();
  try {
    if (!(await replyTableReady(admin, g.user.tenantId))) return none; // 0317a 전 = 버튼 없음
    const messages = await loadMessagesByPosts(admin, g.user.tenantId, postIds);
    const picked: [string, ParentMessage][] = [];
    const vague = new Set<string>(); // 같은 글에 같은 문구의 댓글이 둘 — 공감은 어느 댓글인지 알 수 없어 벨에서는 세우지 않는다
    for (const n of notes ?? []) {
      const note = { type: n.type as string, link: n.link as string | null, body: n.body as string | null, createdAt: (n.created_at as string | null) ?? null };
      const mid = pickMessageForNotification(note, messages);
      const m = mid ? messages.find((x) => x.id === mid) : null;
      if (!m || !replyTargetAllowed(g.mode, { boardName: m.boardName, childId: m.childId }).ok) continue;
      picked.push([n.id as string, m]);
      if (commentNotificationAmbiguous(note, messages)) vague.add(m.id);
    }
    // 전체 모드의 강사 — 알림을 받았어도(출결 알림 수신 등) 답글 자격이 없으면 버튼을 세우지 않는다. 같은 조회는 한 번만(memo).
    let allowed = picked;
    if (g.mode === "on" && !g.manager) {
      const memo: PermissionMemo = new Map();
      const unique = [...new Map(picked.map(([, m]) => [m.id, m])).values()].slice(0, BELL_PERMISSION_CAP);
      const verdicts = await Promise.all(
        unique.map((m) => decideReplyPermission(admin, { user: g.user, manager: false, message: m, sendOn: g.sendOn, mode: g.mode }, memo).then((p) => [m.id, p.canReply] as const, () => [m.id, false] as const)),
      );
      const can = new Set(verdicts.filter(([, ok]) => ok).map(([id]) => id));
      allowed = picked.filter(([, m]) => can.has(m.id));
    } else if (g.mode === "on") {
      // 관리자급 — 자격은 있다. aywa가 모르는 보드(영어 그룹반 등 — 어차피 받지 않는다)의 글엔 버튼을 세우지 않는다.
      const classBoards = await uniqueClassBoardNames(admin, g.user.tenantId, picked.map(([, m]) => m.boardName)).catch(() => new Set<string>());
      allowed = picked.filter(([, m]) => {
        const t = replyTargetAllowed(g.mode, { boardName: m.boardName, childId: m.childId });
        return replyBoardKnown({ mode: g.mode, testBoardId: t.ok ? t.boardId : null, boardIsClass: classBoards.has((m.boardName ?? "").trim()), boardName: m.boardName });
      });
    }
    const targets = Object.fromEntries(allowed.map(([nid, m]) => [nid, m.id]));
    const shown = [...new Set(Object.values(targets))];
    const [reactions, counts] = await Promise.all([reactionViews(admin, g, shown.filter((id) => !vague.has(id))), replyCountsOf(admin, g.user.tenantId, shown)]);
    return { targets, reactions, vague: shown.filter((id) => vague.has(id)), counts };
  } catch {
    return none;
  }
}

/** 메시지별 살아 있는 답글 수 — 못 읽으면 빈 지도(벨 버튼은 그대로, 숫자만 빠진다). */
async function replyCountsOf(admin: ReturnType<typeof createAdminClient>, tenantId: string, messageIds: string[]): Promise<Record<string, number>> {
  try {
    const rows = await loadRepliesForMessages(admin, tenantId, messageIds);
    const counts: Record<string, number> = {};
    for (const r of rows) if (r.messageId && r.status !== "deleted") counts[r.messageId] = (counts[r.messageId] ?? 0) + 1;
    return counts;
  } catch {
    return {};
  }
}

/** 그 메시지들의 공감 상태 — 공감 기능이 없으면(0319a 전·옛 워커) null = 버튼을 그리지 않는다. */
async function reactionViews(admin: ReturnType<typeof createAdminClient>, g: Extract<Awaited<ReturnType<typeof replyGate>>, { ok: true }>, messageIds: string[]): Promise<Record<string, ReactionView> | null> {
  if (!messageIds.length) return null;
  try {
    if (!(await reactionReady(admin, g.user.tenantId))) return null;
    const [rows, ro] = await Promise.all([loadReactions(admin, g.user.tenantId, messageIds), readonlyTeacherViewError()]);
    return Object.fromEntries(messageIds.map((id) => [id, toReactionView(id, rows.get(id) ?? null, g.user, g.manager, !!ro)]));
  } catch {
    return null;
  }
}

/**
 * `noReaction` = 공감 상태를 싣지 않는다 — 벨의 알림이 같은 문구의 댓글 둘 중 어느 것인지 가릴 수 없을 때(그 창에서 공감을 누르면 엉뚱한 댓글에 눌린다).
 */
export async function getParentReplyContext(messageId: string, opts?: { noReaction?: boolean }): Promise<ReplyContext> {
  const g = await replyGate();
  if (!g.ok) return g;
  const admin = createAdminClient();
  try {
    const message = await loadMessage(admin, g.user.tenantId, String(messageId));
    if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
    const [perm, workerReady, readonly, canReact] = await Promise.all([
      decideReplyPermission(admin, { user: g.user, manager: g.manager, message, sendOn: g.sendOn, mode: g.mode }),
      workerAcceptsReplies(admin, g.user.tenantId),
      readonlyTeacherViewError(), // '다른 강사 뷰'(열람 전용) — 수정·삭제 버튼도 세우지 않는다(서버 액션이 어차피 거절한다)
      opts?.noReaction === true ? Promise.resolve(false) : reactionReady(admin, g.user.tenantId).catch(() => false),
    ]);
    // 공감 버튼 — 답글을 쓸 수 있는 사람에게만(같은 자격). 이미 눌린 공감의 상태는 누구에게나 보인다.
    // 쓰레드 — 답글 자격이 있는 사람만 같은 글의 학부모 댓글·영상까지(자격이 없으면 그 글 하나와 그 답글뿐, 종전과 같다).
    const [thread, reactionRow, classnoteUrl] = await Promise.all([
      perm.canReply
        ? buildThread(admin, { user: g.user, manager: g.manager, focus: message, studentId: perm.studentId ?? message.studentId })
        : buildMinimalThread(admin, { user: g.user, manager: g.manager, focus: message }),
      canReact ? loadReaction(admin, g.user.tenantId, message.id).catch(() => null) : Promise.resolve(null),
      readonly ? Promise.resolve(null) : classnoteLinkForHomeroom(admin, g.user, message),
    ]);
    const reaction = canReact && (perm.canReply || reactionRow) ? toReactionView(message.id, reactionRow, g.user, g.manager, !!readonly || !perm.canReply) : null;
    return {
      ok: true,
      message: { id: message.id, source: message.source, content: message.content, boardName: message.boardName, postedAt: message.postedAt },
      thread: readonly ? thread.map((e) => (e.kind === "reply" ? { ...e, reply: { ...e.reply, canChange: false } } : e)) : thread,
      canReply: perm.canReply && workerReady,
      reason: perm.reason ?? (workerReady ? null : "연동 PC가 꺼져 있거나 옛 버전이라 지금 답글을 받을 수 없습니다"),
      authorLabel: perm.authorLabel,
      workerReady,
      maxLength: REPLY_BODY_MAX,
      reaction,
      classnoteUrl,
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
  const g = await replyGate();
  if (!g.ok) return g;
  // 외부(학부모)로 나가는 글 — '다른 강사 뷰'(열람 전용)·지점 보기는 무엇보다 먼저 막는다(decideReplyPermission도 다시 본다).
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro };
  if (!CLIENT_KEY.test(String(input?.clientKey ?? ""))) return { ok: false, error: "잘못된 요청입니다 — 창을 닫고 다시 여세요" };
  const v = validateReplyBody(input?.body);
  if (!v.ok) return { ok: false, error: v.error };
  const admin = createAdminClient();
  const tenantId = g.user.tenantId;
  const message = await loadMessage(admin, tenantId, String(input.messageId)).catch(() => null);
  if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
  const perm = await decideReplyPermission(admin, { user: g.user, manager: g.manager, message, sendOn: g.sendOn, mode: g.mode });
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
  const g = await replyGate();
  if (!g.ok) return g;
  const r = await changeReply({ user: g.user, manager: g.manager, sendOn: g.sendOn, mode: g.mode, replyId: String(input?.replyId ?? ""), kind: "edit", body: input?.body });
  return r.ok ? { ok: true, message: r.message, context: await getParentReplyContext(r.messageId) } : r;
}

/** 답글 삭제(본인 또는 관리자급). 올리기 전이면 바로 취소하고, 게시됐으면 연동 PC가 ClassNote 댓글을 지운다. */
export async function requestParentReplyDelete(input: { replyId: string }): Promise<ReplyActionResult> {
  const g = await replyGate();
  if (!g.ok) return g;
  const r = await changeReply({ user: g.user, manager: g.manager, sendOn: g.sendOn, mode: g.mode, replyId: String(input?.replyId ?? ""), kind: "delete" });
  return r.ok ? { ok: true, message: r.message, context: await getParentReplyContext(r.messageId) } : r;
}
