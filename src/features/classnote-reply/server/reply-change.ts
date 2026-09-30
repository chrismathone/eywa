import "server-only";
import type { CurrentUser } from "@/lib/auth/current-user";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { REPLY_MODE, canChangeReply, validateReplyBody } from "../reply-policy";
import { liveBodiesOnPost, loadReply, workerAcceptsReplies } from "./reply-data";

/**
 * 답글 수정·삭제(0317a) — 작성자 본인은 자기 답글, 원장·관리자·매니저는 모두(원장 결정 2026-09-30).
 * - 올리기 전(queued) = aywa 기록만 바꾼다(ClassNote에 아직 없다). 워커가 집기 전인지 **조건부 update**로 확인한다.
 * - 게시됨(success) = edit_requested/delete_requested로 두고 연동 PC가 ClassNote 댓글을 고치거나 지운다(원문은 edit_history).
 * 🔴 같은 글의 다른 살아 있는 답글과 본문이 같아지는 수정은 막는다(부분 유니크 — 워커가 반영 단계에서 막히지 않게).
 */
type Result = { ok: true; message: string; messageId: string } | { ok: false; error: string };

export async function changeReply(a: { user: CurrentUser; manager: boolean; sendOn: boolean; replyId: string; kind: "edit" | "delete"; body?: unknown }): Promise<Result> {
  const { user, kind } = a;
  if (REPLY_MODE === "off") return { ok: false, error: "답글 기능이 꺼져 있습니다" };
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro };
  const admin = createAdminClient();
  const tenantId = user.tenantId;
  const reply = await loadReply(admin, tenantId, a.replyId).catch(() => null);
  if (!reply || !reply.messageId) return { ok: false, error: "답글을 찾지 못했습니다" };
  if (!canChangeReply({ userId: user.id, role: user.systemRole, manager: a.manager, authorUserId: reply.authorUserId, status: reply.status }))
    return { ok: false, error: reply.status === "queued" || reply.status === "success" ? "내가 쓴 답글만 고칠 수 있습니다(관리자급은 모두)" : "지금은 고칠 수 없는 상태입니다" };

  let body: string | null = null;
  if (kind === "edit") {
    const v = validateReplyBody(a.body);
    if (!v.ok) return { ok: false, error: v.error };
    if (v.body === reply.body) return { ok: false, error: "바뀐 내용이 없습니다" };
    // 다른 답글의 본문뿐 아니라 **수정 대기 본문**과도 겹치면 안 된다 — 둘 다 ClassNote에 반영된 뒤 aywa 기록이 유니크에 걸린다.
    const others = await liveBodiesOnPost(admin, tenantId, reply.classnotePostId).catch(() => null);
    if (!others) return { ok: false, error: "처리하지 못했습니다 — 잠시 뒤 다시 시도하세요" };
    if (others.some((o) => o.id !== reply.id && (o.body === v.body || o.pendingBody === v.body))) return { ok: false, error: "같은 글에 같은 내용의 답글이 이미 있습니다" };
    body = v.body;
  }

  const now = new Date().toISOString();
  const history = [...reply.editHistory, { body: reply.body, replaced_at: now, by: user.id }];
  let patch: Record<string, unknown>;
  let message: string;
  if (reply.status === "queued") {
    // 아직 ClassNote에 없다 — 기록만. 워커가 그 사이 집었으면(processing) 0행 → 다시 시도하라고 알린다.
    patch = kind === "edit"
      ? { body, edit_history: history, edited_at: now, last_action_by: user.id, updated_at: now }
      : { status: "deleted", deleted_at: now, last_action_by: user.id, updated_at: now };
    message = kind === "edit" ? "올리기 전에 고쳤습니다" : "올리기 전에 취소했습니다";
  } else {
    if (!a.sendOn) return { ok: false, error: "ClassNote 발송이 꺼져 있어 지금은 고칠 수 없습니다" };
    if (!(await workerAcceptsReplies(admin, tenantId))) return { ok: false, error: "연동 PC가 꺼져 있거나 옛 버전이라 지금은 고칠 수 없습니다" };
    patch = kind === "edit"
      ? { status: "edit_requested", pending_body: body, last_action_by: user.id, error: null, error_raw: null, failed_action: null, retry_count: 0, updated_at: now }
      : { status: "delete_requested", last_action_by: user.id, error: null, error_raw: null, failed_action: null, retry_count: 0, updated_at: now };
    message = kind === "edit" ? "수정을 요청했습니다 — 연동 PC가 ClassNote 댓글을 고칩니다" : "삭제를 요청했습니다 — 연동 PC가 ClassNote 댓글을 지웁니다";
  }
  const { data, error } = await admin.from("classnote_parent_replies").update(patch).eq("tenant_id", tenantId).eq("id", reply.id).eq("status", reply.status).select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "같은 글에 같은 내용의 답글이 이미 있습니다" };
    console.error("[classnote-reply] 수정·삭제 실패", error);
    return { ok: false, error: "처리하지 못했습니다 — 잠시 뒤 다시 시도하세요" };
  }
  if (!data?.length) return { ok: false, error: "그 사이 상태가 바뀌었습니다 — 창을 새로 고친 뒤 다시 시도하세요" };
  await logAction({
    action: kind === "edit" ? "classnote_parent_reply_edit_request" : "classnote_parent_reply_delete_request",
    targetType: "classnote_parent_reply",
    targetLabel: `학부모 답글 ${kind === "edit" ? "수정" : "삭제"}${reply.status === "queued" ? "(올리기 전)" : ""}`,
    metadata: { replyId: reply.id, messageId: reply.messageId, postId: reply.classnotePostId, author: reply.authorLabel, own: reply.authorUserId === user.id, beforeLength: reply.body.length, ...(body ? { length: body.length } : {}) },
  });
  return { ok: true, message, messageId: reply.messageId };
}
