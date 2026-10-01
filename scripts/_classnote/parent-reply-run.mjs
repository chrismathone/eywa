// scripts/_classnote/parent-reply-run.mjs — 답글(0317a) **한 행을 ClassNote에 반영**하는 자리. 댓글 쓰기는 이 함수에서만 일어난다.
//
// 코어(classnote-parent-reply-core.mjs)에서 떼어 둔 이유: 여기는 가드(parent-reply-guard)와 요청 헬퍼(parent-reply-api)만
// import한다(playwright·postgres 없음) — 가짜 페이지로 **쓰기 경로 전체**를 Vitest가 돌려 본다(parent-reply-run.test.mjs):
// 가드에 걸리면 요청이 한 건도 안 나가는지, 2xx 뒤 글자가 안 맞아도 다시 올리지 않는지, 남이 고친 댓글에 손대지 않는지.
//
// 순서(전부 매번): 사전 판정 → 원글 다시 읽기 → 보드·원아 대조 + 모드별 대상 확인(= 쓰기 허가증) → 댓글 다시 읽기 →
//   게시: 같은 본문의 봇 댓글이 있으면 올리지 않는다 → **설정 다시 읽기** → 쓰기 → 다시 읽어 확인
//   수정·삭제: 번호가 같고 학부모 것이 아니며 내용이 aywa 기록과 같은 댓글만 → **설정 다시 읽기** → 쓰기 → 다시 읽어 확인
// 🔴 모드는 코어가 DB에서 읽어 **인자로** 넘긴다(`mode`) — 이 파일엔 모드 상수가 없다. 쓰기 직전엔 `recheckMode`로 한 번 더 읽어,
//    그 사이 끔·시험으로 내렸으면 쓰지 않는다(요청은 남는다 — 다시 켜면 이어서 간다).
import {
  buildReplyPayload,
  classifyWriteStatus,
  evaluateReplyTarget,
  findExistingReplyComment,
  findOwnComment,
  isReplyPostExpired,
  isReplyTestTarget,
  normalizeReplyMode,
  normalizeReplyText,
  preflightReplyRow,
  resolvePostedComment,
  sameReplyText,
} from "./parent-reply-guard.mjs";
import { deleteComment, getPost, listComments, writeComment } from "./parent-reply-api.mjs";

/**
 * 원글을 다시 읽어 대상을 확인한다(답글·공감 공용) — 통과하면 `permit`(쓰기 허가증), 아니면 `out`(그대로 돌려줄 결과).
 * on 모드의 확정 연결 기록(`loadFacts`)은 시험 보드가 아닐 때만 읽는다. 못 읽으면 쓰지 않고 다시 시도.
 * @param {{ mode: string, loadBoardChildren: (boardId:number) => Promise<Array|null>, loadFacts?: (boardId:number) => Promise<object|null>, authorName?: string|null }} deps
 */
export async function confirmReplyTarget(page, row, { mode, loadBoardChildren, loadFacts = null, authorName = null }) {
  const post = await getPost(page, Number(row.classnote_post_id), { authorName });
  const readable = post?.status === 200 && post.cls != null;
  const boardChildren = readable ? await loadBoardChildren(post.cls).catch(() => null) : null;
  const needFacts = readable && normalizeReplyMode(mode) === "on" && !isReplyTestTarget({ boardId: post.cls, childId: post.child });
  const facts = needFacts && loadFacts ? await loadFacts(Number(post.cls)).catch(() => null) : null;
  const permit = evaluateReplyTarget({ mode, row, post, boardChildren, facts });
  if (!permit.ok) return { permit: null, post, out: { kind: permit.retry ? "retryable" : "blocked", code: permit.code, raw: post?.detail ?? null } };
  return { permit, post, out: null };
}

/**
 * 쓰기 요청을 보내다 **던져도**(브라우저 끊김 등) 결과 모름(상태 0)으로 받는다 — 요청이 이미 나갔을 수 있어서다(호출부가 다시 읽어 판정하고
 * `sent` 표식을 남긴다). 쓰기 가드가 던진 것(요청 전)은 그대로 던진다.
 */
export async function sendSafely(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e?.code === "REPLY_WRITE_GUARD") throw e;
    return { status: 0, detail: String(e?.message ?? e).slice(0, 300), id: null };
  }
}

/** 쓰기 직전에 설정을 다시 읽는다 — 못 읽으면 끔. 확인한 때(`permit.mode`)와 다르면 null(쓰지 않는다). */
export async function liveModeFor(permit, recheckMode) {
  const live = normalizeReplyMode(await Promise.resolve().then(recheckMode).catch(() => "off"));
  return live === permit.mode ? live : null;
}

/**
 * @param {object} page  로그인된 봇 페이지
 * @param {object} row   처리 중인 답글 행(classnote_parent_replies)
 * @param {"post"|"edit"|"delete"} action
 * @param {{ mode: string, recheckMode?: () => Promise<string>, claimed?: Set<number>, onComments?: (list: Array) => Promise<Iterable<number>|null|void>, progress?: {sent?: boolean},
 *           loadBoardChildren: (boardId:number) => Promise<Array<{id:number, name?:string}>|null>, loadFacts?: (boardId:number) => Promise<object|null> }} deps
 *   mode = 코어가 DB에서 읽은 설정값 · recheckMode = 쓰기 직전에 다시 읽기(없으면 같은 값)
 *   claimed = 같은 글의 **다른 답글 행이 제 것으로 적은** 댓글 번호(그 댓글을 이 행의 것으로 또 적지 않는다)
 *   onComments = 댓글 목록을 읽은 직후 한 번 — 코어가 '올라갔는지 모른 채 실패로 끝난' 답글을 그 목록에서 되찾는다. 돌려준 댓글 번호는 claimed에 더한다
 *   progress = 게시 요청을 보낸 순간 `sent`를 세우는 그릇(이 함수가 그 뒤에 던져도 코어가 '보냈는데 모름' 표식을 남긴다)
 * @returns {Promise<{kind:string, code?:string, raw?:string|null, commentId?:number, boardId?:number, sent?:boolean}>}
 *   kind: done · already · gone · blocked(가드·거절 — 재시도 없음) · retryable(결과를 모른다 — 다시 읽어 판정)
 *   sent = 게시 요청을 보냈지만 결과를 확정하지 못했다(ClassNote에 올라갔을 수 있다)
 *   absent = 댓글 목록을 읽어 이 답글이 **없음을 확인한 뒤** 끝났다(게시에서만 — 앞선 시도의 '보냈는데 모름' 표식을 내린다)
 */
export async function runReplyOnce(page, row, action, { mode, recheckMode = async () => mode, claimed = new Set(), onComments = null, loadBoardChildren, loadFacts = null, progress = {} }) {
  const pre = preflightReplyRow({ mode, row }); // 코어 precheck가 이미 봤지만 쓰는 함수 안에서 한 번 더(순수 · 비용 0)
  if (!pre.ok) return { kind: "blocked", code: pre.code };
  const postId = Number(row.classnote_post_id);
  const { permit, out } = await confirmReplyTarget(page, row, { mode, loadBoardChildren, loadFacts }); // 통과하면 permit이 쓰기 허가증
  if (!permit) return out;
  const boardId = permit.boardId;
  const listed = await listComments(page, postId);
  if (!listed.ok) return { kind: "retryable", code: "comments_unavailable", raw: listed.detail, boardId };
  const recovered = onComments ? await Promise.resolve().then(() => onComments(listed.list)).catch(() => null) : null;
  if (recovered) for (const id of recovered) claimed.add(Number(id));
  const mine = (list) => list.filter((c) => !claimed.has(Number(c?.id)));
  const changed = { kind: "retryable", code: "mode_changed", boardId };

  if (action === "post") {
    const existing = findExistingReplyComment(mine(listed.list), { body: row.body, authorName: row.author_label });
    if (existing) return { kind: "already", commentId: existing, boardId };
    // 묵은 요청은 올리지 않는다 — 위 '이미 있나' 확인 **뒤**에 건다(이미 올라간 것을 "올리지 못함"으로 적지 않게).
    // 여기부터는 댓글 목록을 읽어 이 답글이 **없음을 확인한 뒤**다(absent).
    if (isReplyPostExpired(row)) return { kind: "blocked", code: "expired", boardId, absent: true };
    let payload;
    try {
      payload = buildReplyPayload({ authorName: row.author_label, body: row.body });
    } catch (e) {
      return { kind: "blocked", code: "invalid", raw: e.message, boardId, absent: true };
    }
    const live = await liveModeFor(permit, recheckMode);
    if (!live) return { ...changed, absent: true };
    progress.sent = true; // 이 줄 뒤로는 요청이 나갔을 수 있다
    const res = await sendSafely(() => writeComment(page, permit, { postId, mode: live }, payload));
    const verdict = classifyWriteStatus(res.status);
    if (verdict === "rejected") return { kind: "blocked", code: "rejected", raw: res.detail, boardId, absent: true };
    // 2xx여도, 불확실해도 **다시 읽어** 확인한다 — 응답만 믿지 않는다(공지 409 사고 교훈).
    // 다시 읽다가 브라우저가 던져도 '못 읽음'으로 받는다(예외로 새면 '보냈는데 모름' 표식을 잃는다).
    const again = await listComments(page, postId).catch((e) => ({ ok: false, detail: String(e?.message ?? e).slice(0, 200) }));
    const found = again.ok
      ? resolvePostedComment({
          before: listed.list, after: mine(again.list), body: row.body, authorName: row.author_label, responseId: verdict === "ok" ? res.id : null,
        })
      : null;
    if (found) return { kind: verdict === "ok" ? "done" : "already", commentId: found, boardId };
    // 목록에서 못 찾았어도(다시 못 읽음·반영 지연) 2xx에 **만든 댓글 번호**까지 받았으면 만들어진 것이다 — 다시 올리면 중복이다.
    if (verdict === "ok" && res.id) return { kind: "done", commentId: res.id, boardId };
    // 그 밖은 결과를 모른다 — 다음 폴이 댓글을 다시 읽어 없을 때만 다시 쓴다(상한 REPLY_RETRY_MAX).
    // 🔴 `sent` = 요청은 나갔다. 다시 읽어 **없음을 확인한** 경우만 빼고(아래 둘째 줄) ClassNote에 올라갔을 수 있다.
    if (!again.ok) return { kind: "retryable", code: "comments_unavailable", raw: again.detail, boardId, sent: true };
    return { kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId, sent: verdict === "ok", absent: verdict !== "ok" };
  }

  const own = findOwnComment(listed.list, row.classnote_comment_id);
  if (!own) return { kind: "gone", code: "gone", boardId };
  if (action === "edit") {
    const want = normalizeReplyText(row.pending_body);
    if (sameReplyText(own.content, want)) return { kind: "already", commentId: own.id, boardId };
    if (!sameReplyText(own.content, row.body)) return { kind: "blocked", code: "not_ours", boardId };
    const live = await liveModeFor(permit, recheckMode);
    if (!live) return changed;
    const res = await writeComment(page, permit, { postId, commentId: own.id, mode: live }, { content: want });
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
  const live = await liveModeFor(permit, recheckMode);
  if (!live) return changed;
  const res = await deleteComment(page, permit, { postId, commentId: own.id, mode: live });
  if (classifyWriteStatus(res.status) === "rejected" && res.status !== 404) return { kind: "blocked", code: "rejected", raw: res.detail, boardId };
  const again = await listComments(page, postId);
  if (!again.ok) return { kind: "retryable", code: "comments_unavailable", raw: again.detail, boardId };
  return findOwnComment(again.list, own.id)
    ? { kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId }
    : { kind: "done", commentId: own.id, boardId };
}
