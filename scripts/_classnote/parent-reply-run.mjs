// scripts/_classnote/parent-reply-run.mjs — 답글(0317a) **한 행을 ClassNote에 반영**하는 자리. ClassNote 쓰기는 이 함수에서만 일어난다.
//
// 코어(classnote-parent-reply-core.mjs)에서 떼어 둔 이유: 여기는 가드(parent-reply-guard)와 요청 헬퍼(parent-reply-api)만
// import한다(playwright·postgres 없음) — 가짜 페이지로 **쓰기 경로 전체**를 Vitest가 돌려 본다(parent-reply-run.test.mjs):
// 가드에 걸리면 요청이 한 건도 안 나가는지, 2xx 뒤 글자가 안 맞아도 다시 올리지 않는지, 남이 고친 댓글에 손대지 않는지.
//
// 순서(전부 매번): 사전 판정 → 원글 다시 읽기 → 보드·원아 대조 + 테스트 보드 원아 확인(= 쓰기 허가증) → 댓글 다시 읽기 →
//   게시: 같은 본문의 봇 댓글이 있으면 올리지 않는다 → 쓰기 → 다시 읽어 확인
//   수정·삭제: 번호가 같고 학부모 것이 아니며 내용이 aywa 기록과 같은 댓글만 → 쓰기 → 다시 읽어 확인
import {
  REPLY_MODE,
  buildReplyPayload,
  classifyWriteStatus,
  evaluateReplyTarget,
  findExistingReplyComment,
  findOwnComment,
  isReplyPostExpired,
  normalizeReplyText,
  preflightReplyRow,
  resolvePostedComment,
  sameReplyText,
} from "./parent-reply-guard.mjs";
import { deleteComment, getPost, listComments, writeComment } from "./parent-reply-api.mjs";

/**
 * @param {object} page  로그인된 봇 페이지
 * @param {object} row   처리 중인 답글 행(classnote_parent_replies)
 * @param {"post"|"edit"|"delete"} action
 * @param {{ claimed?: Set<number>, loadBoardChildren: (boardId:number) => Promise<Array<{id:number, name?:string}>|null> }} deps
 *   claimed = 같은 글의 **다른 답글 행이 제 것으로 적은** 댓글 번호(그 댓글을 이 행의 것으로 또 적지 않는다)
 * @returns {Promise<{kind:string, code?:string, raw?:string|null, commentId?:number, boardId?:number}>}
 *   kind: done · already · gone · blocked(가드·거절 — 재시도 없음) · retryable(결과를 모른다 — 다시 읽어 판정)
 */
export async function runReplyOnce(page, row, action, { claimed = new Set(), loadBoardChildren }) {
  const pre = preflightReplyRow({ mode: REPLY_MODE, row }); // 코어 precheck가 이미 봤지만 쓰는 함수 안에서 한 번 더(순수 · 비용 0)
  if (!pre.ok) return { kind: "blocked", code: pre.code };
  const postId = Number(row.classnote_post_id);
  const post = await getPost(page, postId);
  const boardChildren = post?.status === 200 && post.cls ? await loadBoardChildren(post.cls).catch(() => null) : null;
  const permit = evaluateReplyTarget({ mode: REPLY_MODE, row, post, boardChildren }); // 통과하면 이 값이 쓰기 허가증
  if (!permit.ok) return { kind: permit.retry ? "retryable" : "blocked", code: permit.code, raw: post?.detail ?? null };
  const boardId = permit.boardId;
  const listed = await listComments(page, postId);
  if (!listed.ok) return { kind: "retryable", code: "comments_unavailable", raw: listed.detail, boardId };
  const mine = (list) => list.filter((c) => !claimed.has(Number(c?.id)));

  if (action === "post") {
    const existing = findExistingReplyComment(mine(listed.list), { body: row.body, authorName: row.author_label });
    if (existing) return { kind: "already", commentId: existing, boardId };
    // 묵은 요청은 올리지 않는다 — 위 '이미 있나' 확인 **뒤**에 건다(이미 올라간 것을 "올리지 못함"으로 적지 않게).
    if (isReplyPostExpired(row)) return { kind: "blocked", code: "expired", boardId };
    let payload;
    try {
      payload = buildReplyPayload({ authorName: row.author_label, body: row.body });
    } catch (e) {
      return { kind: "blocked", code: "invalid", raw: e.message, boardId };
    }
    const res = await writeComment(page, permit, { postId }, payload);
    const verdict = classifyWriteStatus(res.status);
    if (verdict === "rejected") return { kind: "blocked", code: "rejected", raw: res.detail, boardId };
    // 2xx여도, 불확실해도 **다시 읽어** 확인한다 — 응답만 믿지 않는다(공지 409 사고 교훈).
    const again = await listComments(page, postId);
    const found = again.ok
      ? resolvePostedComment({
          before: listed.list, after: mine(again.list), body: row.body, authorName: row.author_label, responseId: verdict === "ok" ? res.id : null,
        })
      : null;
    if (found) return { kind: verdict === "ok" ? "done" : "already", commentId: found, boardId };
    // 목록에서 못 찾았어도(다시 못 읽음·반영 지연) 2xx에 **만든 댓글 번호**까지 받았으면 만들어진 것이다 — 다시 올리면 중복이다.
    if (verdict === "ok" && res.id) return { kind: "done", commentId: res.id, boardId };
    // 그 밖은 결과를 모른다 — 다음 폴이 댓글을 다시 읽어 없을 때만 다시 쓴다(상한 REPLY_RETRY_MAX).
    if (!again.ok) return { kind: "retryable", code: "comments_unavailable", raw: again.detail, boardId };
    return { kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId };
  }

  const own = findOwnComment(listed.list, row.classnote_comment_id);
  if (!own) return { kind: "gone", code: "gone", boardId };
  if (action === "edit") {
    const want = normalizeReplyText(row.pending_body);
    if (sameReplyText(own.content, want)) return { kind: "already", commentId: own.id, boardId };
    if (!sameReplyText(own.content, row.body)) return { kind: "blocked", code: "not_ours", boardId };
    const res = await writeComment(page, permit, { postId, commentId: own.id }, { content: want });
    const verdict = classifyWriteStatus(res.status);
    if (verdict === "rejected") return { kind: "blocked", code: "rejected", raw: res.detail, boardId };
    const again = await listComments(page, postId);
    if (!again.ok) return { kind: "retryable", code: "comments_unavailable", raw: again.detail, boardId };
    const now = findOwnComment(again.list, own.id);
    if (!now) return { kind: "gone", code: "gone", boardId };
    // 2xx를 받았고 내용이 옛 본문에서 **바뀌었으면** 반영된 것이다(ClassNote가 다듬어 저장해 글자가 조금 달라도) —
    // 이걸 '불확실'로 돌리면 다음 폴에 "aywa 기록과 다름"으로 막혀 aywa만 옛 본문으로 남는다.
    const applied = sameReplyText(now.content, want) || (verdict === "ok" && !sameReplyText(now.content, row.body));
    return applied
      ? { kind: "done", commentId: own.id, boardId }
      : { kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId };
  }
  if (action !== "delete") return { kind: "blocked", code: "invalid", boardId };
  if (!sameReplyText(own.content, row.body)) return { kind: "blocked", code: "not_ours", boardId };
  const res = await deleteComment(page, permit, { postId, commentId: own.id });
  if (classifyWriteStatus(res.status) === "rejected" && res.status !== 404) return { kind: "blocked", code: "rejected", raw: res.detail, boardId };
  const again = await listComments(page, postId);
  if (!again.ok) return { kind: "retryable", code: "comments_unavailable", raw: again.detail, boardId };
  return findOwnComment(again.list, own.id)
    ? { kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId }
    : { kind: "done", commentId: own.id, boardId };
}
