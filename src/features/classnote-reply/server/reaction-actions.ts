"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { readonlyTeacherViewError } from "@/lib/auth/view-mode";
import { logAction } from "@/features/audit/server/log";
import { REACTION_LABELS, canPressReaction, canRemoveReaction, isReactionType } from "../reaction-policy";
import { replyTargetAllowed } from "../reply-policy";
import type { ReactionActionResult, ReactionView } from "../reply-types";
import { loadMessage, workerAcceptsReplies } from "./reply-data";
import { replyGate } from "./reply-gate";
import { decideReplyPermission } from "./reply-permission";
import { isMissingReactionTable, loadReaction, reactionReady, toReactionView } from "./reaction-data";

/**
 * 학부모 글·댓글 **공감**(0319a) 서버 액션. 입력은 메시지 행 id(+ 종류)뿐 — 글·댓글·원아·보드는 서버가 0184a 행으로 다시 찾는다.
 * 게이트는 답글과 **같다**: 로그인·학생 아님 → 모드(끔이면 없는 기능) → 발송 스위치·열람 전용·자격·대상 확정(`decideReplyPermission`)
 * → 연동 PC(`caps.parentReaction`) → 감사로그. 공감한 사람으로 보이는 이름 = 답글 게시 명의와 같은 규칙(`<반 이름> <강사 호칭>`).
 * 🔴 학부모 메시지 하나에 공감 하나(지점 단위) — 이미 눌려 있으면 또 받지 않는다. 풀었거나 못 눌렀으면 **같은 행을 다시 쓴다**.
 * 🔴 '확인 필요'(`unconfirmed` — 앞선 누르기 요청이 ClassNote에 반영됐는지 모른다)인 행은 **명의·종류를 덮어쓰지 않고** 그 공감부터 다시 확인시킨다.
 *    덮어쓰면 ClassNote에 눌려 있을 수 있는 공감을 aywa가 잊어 풀 길이 없고, 다른 명의로 하나 더 눌린다(적대 리뷰 2026-10-01).
 *    🔴 이때 **요청 시각(`requested_at`)은 갱신하지 않는다** — 워커는 그 명의로 읽어 눌려 있으면 성공으로, 없고 요청이 하루를 넘겼으면
 *    누르지 않고 표식만 내린다(묵은 요청을 옛 명의로 뒤늦게 누르지 않게). 지금 누른 사람의 선택은 **반영되지 않으므로** 성공이 아니라 안내로 답한다.
 * 표가 없으면(0319a 전) 없는 기능으로 답한다([[#95]]).
 */
const UNAVAILABLE = "사용할 수 없는 기능입니다";
const WORKER_DOWN = "연동 PC가 꺼져 있거나 옛 버전이라 지금은 공감을 반영할 수 없습니다";
const RETRY = "처리하지 못했습니다 — 잠시 뒤 다시 시도하세요";

/** 그 메시지의 지금 공감 상태(버튼이 처리 중일 때 다시 읽는다). 공감 기능이 없으면 null. */
export async function getParentReactionState(messageId: string): Promise<ReactionView | null> {
  const g = await replyGate();
  if (!g.ok) return null;
  const admin = createAdminClient();
  try {
    if (!(await reactionReady(admin, g.user.tenantId))) return null;
    const [row, ro] = await Promise.all([loadReaction(admin, g.user.tenantId, String(messageId)), readonlyTeacherViewError()]);
    return toReactionView(String(messageId), row, g.user, g.manager, !!ro);
  } catch {
    return null;
  }
}

export async function requestParentReaction(input: { messageId: string; type: string }): Promise<ReactionActionResult> {
  const g = await replyGate();
  if (!g.ok) return g;
  // 외부(학부모 글)에 대상 직원 명의로 눌리는 공감 — '다른 강사 뷰'(열람 전용)·지점 보기는 먼저 막는다(decideReplyPermission도 다시 본다).
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro };
  if (!isReactionType(input?.type)) return { ok: false, error: "공감 종류를 다시 골라 주세요" };
  const admin = createAdminClient();
  const tenantId = g.user.tenantId;
  const message = await loadMessage(admin, tenantId, String(input.messageId)).catch(() => null);
  if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
  const perm = await decideReplyPermission(admin, { user: g.user, manager: g.manager, message, sendOn: g.sendOn, mode: g.mode });
  if (!perm.canReply) return { ok: false, error: perm.reason.replace(/답글을 (쓸|올릴|보낼) 수/g, "공감을 누를 수") };
  if (!(await workerAcceptsReplies(admin, tenantId, "parentReaction"))) return { ok: false, error: WORKER_DOWN };
  const view = (row: Awaited<ReturnType<typeof loadReaction>>) => toReactionView(message.id, row, g.user, g.manager);
  let existing;
  try {
    existing = await loadReaction(admin, tenantId, message.id);
  } catch (e) {
    return { ok: false, error: isMissingReactionTable(e) ? UNAVAILABLE : RETRY };
  }
  if (existing && !canPressReaction(existing.status)) {
    const busy = existing.status !== "success";
    return { ok: false, error: busy ? "공감을 처리하는 중입니다 — 잠시 뒤 다시 확인하세요" : `이미 공감한 글입니다(${existing.authorLabel})`, reaction: view(existing) };
  }
  const now = new Date().toISOString();
  if (existing?.unconfirmed) {
    // 앞선 공감이 눌렸는지 모른다 — 그 행 그대로(명의·종류·요청 시각) 연동 PC에 다시 확인시킨다. 지금 고른 종류는 싣지 않는다.
    const { data: back, error: backErr } = await admin.from("classnote_parent_reactions")
      .update({ status: "queued", processing_action: null, error: null, error_raw: null, failed_action: null, retry_count: 0, last_action_by: g.user.id, updated_at: now })
      .eq("tenant_id", tenantId).eq("id", existing.id).eq("status", existing.status).select("id");
    if (backErr) return { ok: false, error: RETRY };
    const latest = await loadReaction(admin, tenantId, message.id).catch(() => existing);
    if (!back?.length) return { ok: false, error: "그 사이 상태가 바뀌었습니다 — 다시 확인해 주세요", reaction: view(latest) };
    await logAction({
      action: "classnote_parent_reaction_request",
      targetType: "classnote_parent_reaction",
      targetLabel: `학부모 ${message.source === "comment" ? "댓글" : "글"} 공감 다시 확인(${message.boardName ?? "보드 미상"})`,
      metadata: { reactionRowId: existing.id, messageId: message.id, postId: message.classnotePostId, author: existing.authorLabel, recheck: true, manager: g.manager },
    });
    return { ok: false, error: `앞서 요청한 공감(${existing.authorLabel})이 ClassNote에 눌렸는지 확인하지 못했습니다 — 그것부터 확인합니다. 확인이 끝난 뒤 다시 눌러 주세요`, reaction: view(latest) };
  }
  const fields = {
    classnote_post_id: message.classnotePostId, target_comment_id: message.source === "comment" ? message.classnoteCommentId : null,
    board_id: perm.boardId, board_name: message.boardName, child_id: message.childId, student_id: perm.studentId,
    reaction_type: input.type, author_user_id: g.user.id, author_label: perm.authorLabel, last_action_by: g.user.id,
    status: "queued", processing_action: null, classnote_reaction_id: null, error: null, error_raw: null, failed_action: null, retry_count: 0,
    requested_at: now, updated_at: now,
  };
  // 행이 있으면(못 눌렀거나 풀었다) **그 상태일 때만** 다시 쓴다 — 그 사이 다른 사람이 눌렀으면 0행. 없으면 insert(23505 = 누가 먼저 눌렀다).
  const res = existing
    ? await admin.from("classnote_parent_reactions").update(fields).eq("tenant_id", tenantId).eq("id", existing.id).eq("status", existing.status).select("id")
    : await admin.from("classnote_parent_reactions").insert({ tenant_id: tenantId, message_id: message.id, ...fields }).select("id");
  if (res.error || !res.data?.length) {
    if (res.error && isMissingReactionTable(res.error)) return { ok: false, error: UNAVAILABLE };
    if (res.error && res.error.code !== "23505") {
      console.error("[classnote-reaction] 요청 실패", res.error);
      return { ok: false, error: RETRY };
    }
    const latest = await loadReaction(admin, tenantId, message.id).catch(() => null);
    return { ok: false, error: "그 사이 다른 사람이 먼저 공감했습니다", reaction: latest ? view(latest) : null };
  }
  await logAction({
    action: "classnote_parent_reaction_request",
    targetType: "classnote_parent_reaction",
    targetLabel: `학부모 ${message.source === "comment" ? "댓글" : "글"}에 공감 '${REACTION_LABELS[input.type]}'(${message.boardName ?? "보드 미상"})`,
    metadata: { reactionRowId: res.data[0]!.id, messageId: message.id, postId: message.classnotePostId, author: perm.authorLabel, reaction: REACTION_LABELS[input.type], manager: g.manager },
  });
  const saved = await loadReaction(admin, tenantId, message.id).catch(() => null);
  return { ok: true, message: "공감을 요청했습니다 — 연동 PC가 곧 ClassNote에 누릅니다", reaction: view(saved) };
}

/** 공감 풀기(누른 사람 본인 또는 관리자급). 아직 안 눌렸으면 바로 취소하고, 눌려 있으면 연동 PC가 ClassNote에서 푼다. */
export async function requestParentReactionRemove(input: { messageId: string }): Promise<ReactionActionResult> {
  const g = await replyGate();
  if (!g.ok) return g;
  const ro = await readonlyTeacherViewError();
  if (ro) return { ok: false, error: ro };
  const admin = createAdminClient();
  const tenantId = g.user.tenantId;
  const message = await loadMessage(admin, tenantId, String(input?.messageId ?? "")).catch(() => null);
  if (!message) return { ok: false, error: "학부모 글 원문을 찾지 못했습니다" };
  // 시험 모드에서는 학원이 글의 공감만 손댄다(그 밖은 워커가 어차피 거절한다 — 요청만 쌓이지 않게 여기서 막는다).
  if (!replyTargetAllowed(g.mode, { boardName: message.boardName, childId: message.childId }).ok) return { ok: false, error: "지금 단계에서는 이 글의 공감을 바꿀 수 없습니다" };
  let row;
  try {
    row = await loadReaction(admin, tenantId, message.id);
  } catch (e) {
    return { ok: false, error: isMissingReactionTable(e) ? UNAVAILABLE : RETRY };
  }
  const view = (r: typeof row) => toReactionView(message.id, r, g.user, g.manager);
  if (!row) return { ok: false, error: "공감 기록이 없습니다" };
  if (row.status === "queued" && row.unconfirmed)
    return { ok: false, error: "연동 PC가 이 공감이 ClassNote에 눌렸는지 확인하는 중입니다 — 확인이 끝난 뒤 풀어 주세요", reaction: view(row) };
  if (!canRemoveReaction({ userId: g.user.id, role: g.user.systemRole, manager: g.manager, authorUserId: row.authorUserId, status: row.status }))
    return { ok: false, error: row.status === "queued" || row.status === "success" ? "내가 누른 공감만 풀 수 있습니다(관리자급은 모두)" : "지금은 풀 수 없는 상태입니다", reaction: view(row) };
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  let text: string;
  if (row.status === "queued") {
    patch = { status: "removed", removed_at: now, last_action_by: g.user.id, updated_at: now };
    text = "누르기 전에 취소했습니다";
  } else {
    if (!g.sendOn) return { ok: false, error: "ClassNote 발송이 꺼져 있어 지금은 풀 수 없습니다" };
    if (!(await workerAcceptsReplies(admin, tenantId, "parentReaction"))) return { ok: false, error: WORKER_DOWN };
    patch = { status: "remove_requested", last_action_by: g.user.id, error: null, error_raw: null, failed_action: null, retry_count: 0, updated_at: now };
    text = "공감 풀기를 요청했습니다 — 연동 PC가 ClassNote에서 풉니다";
  }
  const { data, error } = await admin.from("classnote_parent_reactions").update(patch).eq("tenant_id", tenantId).eq("id", row.id).eq("status", row.status).select("id");
  if (error) {
    console.error("[classnote-reaction] 풀기 실패", error);
    return { ok: false, error: RETRY };
  }
  if (!data?.length) return { ok: false, error: "그 사이 상태가 바뀌었습니다 — 다시 확인해 주세요", reaction: view(await loadReaction(admin, tenantId, message.id).catch(() => row)) };
  await logAction({
    action: "classnote_parent_reaction_remove_request",
    targetType: "classnote_parent_reaction",
    targetLabel: `학부모 ${message.source === "comment" ? "댓글" : "글"} 공감 풀기${row.status === "queued" ? "(누르기 전)" : ""}`,
    metadata: { reactionRowId: row.id, messageId: message.id, postId: message.classnotePostId, author: row.authorLabel, own: row.authorUserId === g.user.id },
  });
  return { ok: true, message: text, reaction: view(await loadReaction(admin, tenantId, message.id).catch(() => row)) };
}
