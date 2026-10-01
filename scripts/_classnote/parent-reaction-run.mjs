// scripts/_classnote/parent-reaction-run.mjs — 공감(0319a) **한 행을 ClassNote에 반영**하는 자리. 공감 쓰기는 이 함수에서만 일어난다.
//
// 답글 실행(parent-reply-run.mjs)과 같은 뼈대: 사전 판정 → 원글 다시 읽기 + 모드별 대상 확인(= 쓰기 허가증, 답글과 **같은 가드**) →
// 지금 공감 상태 읽기 → **설정 다시 읽기** → 쓰기 → 다시 읽어 확인. playwright·postgres를 import하지 않는다(가짜 페이지로 Vitest가 돌린다).
//
// 🔑 ClassNote 공감은 (계정·명의·종류)당 하나라 같은 요청을 다시 보내도 늘지 않는다(멱등 — 2026-10-01 실측). 그래도 먼저 읽어
//    이미 눌려 있으면 쓰지 않는다. `my_reactions`는 **그 명의로** 읽어야 나온다(`?author_name=`, gotchas #136).
// 🔴 풀기는 **그 명의의 공감 목록에 그 번호가 있을 때만** — 남이 누른 공감을 풀지 않는다. 풀고 나서는 **다시 읽어** 사라졌을 때만 '풀림'으로 적는다.
// 🔴 쓰기 요청을 **보냈는데 결과를 확정하지 못한** 결과에는 `sent: true`를 싣는다 — 코어가 행에 '확인 필요' 표식을 남기고, 앱은 그 행을
//    취소하거나 다른 명의·종류로 덮어쓰지 않는다(ClassNote에 눌려 있을 수 있는 공감을 aywa가 잊지 않게 — 적대 리뷰 2026-10-01).
//    반대로 그 명의로 읽어 **그 종류가 없음을 확인한 뒤에** 끝난 결과에는 `absent: true`를 싣는다 — 코어가 표식을 내린다(그래야 그 뒤에
//    다른 명의·종류로 새로 누를 수 있다).
// 🔴 **'확인 필요' 표식이 선 행(`row.unconfirmed`)은 읽기만 한다** — 그 명의로 읽어 눌려 있으면 성공, 없으면 **누르지 않고** 표식만 내려
//    실패로 끝낸다(재리뷰 2026-10-01). 그 행이 다시 온 까닭은 "앞선 요청이 눌렸는지 확인"이지 "다시 눌러라"가 아니다 — 다시 누르면
//    지금 누른 사람이 고른 종류·명의 대신 옛 요청이 뒤늦게 나간다. 확인이 끝난 뒤 사용자가 다시 누르면 그때 새 요청으로 간다.
//    쓰기 뒤 다시 읽다가 브라우저가 던져도 '못 읽음'으로 받고, 쓰기를 보낸 순간 `progress.sent`를 세운다(예외로 새도 코어가 표식을 세운다).
// 🔴 그 명의로 **다른 종류**가 이미 눌려 있으면(aywa는 메시지당 하나) 그것부터 풀고 누른다 — 같은 명의의 공감이 둘이 되지 않게.
import { classifyWriteStatus } from "./parent-reply-guard.mjs";
import { deleteReaction, getPost, listComments, listReactionTypes, writeReaction } from "./parent-reply-api.mjs";
import { findMyReaction, hasMyReaction, isReactionExpired, preflightReactionRow, reactionRowForGuard } from "./parent-reaction-guard.mjs";
import { confirmReplyTarget, liveModeFor, sendSafely } from "./parent-reply-run.mjs";

/**
 * 그 명의의 지금 공감 목록 — 글이면 글의 `my_reactions`, 댓글이면 그 댓글의 것. 못 읽으면 ok:false(쓰지 않는다).
 * @returns {Promise<{ok:true, mine:Array, missing?:boolean, authorType?:string|null}|{ok:false, code:string, raw?:string|null}>}
 */
async function readMine(page, { postId, commentId, authorName, post = null }) {
  if (commentId == null) {
    const p = post ?? (await getPost(page, postId, { authorName }));
    if (p?.status !== 200 || !Array.isArray(p.myReactions)) return { ok: false, code: "reactions_unavailable", raw: p?.detail ?? null };
    return { ok: true, mine: p.myReactions };
  }
  const listed = await listComments(page, postId, { authorName });
  if (!listed.ok) return { ok: false, code: "comments_unavailable", raw: listed.detail };
  const c = listed.list.find((x) => Number(x?.id) === Number(commentId));
  if (!c) return { ok: true, mine: [], missing: true };
  if (!Array.isArray(c.my_reactions)) return { ok: false, code: "reactions_unavailable", raw: null };
  return { ok: true, mine: c.my_reactions, authorType: c.author?.type ?? null };
}

/**
 * @param {object} page  로그인된 봇 페이지
 * @param {object} row   처리 중인 공감 행(classnote_parent_reactions)
 * @param {"add"|"remove"} action
 * @param {{ mode: string, recheckMode?: () => Promise<string>, loadBoardChildren: (boardId:number) => Promise<Array|null>, loadFacts?: (boardId:number) => Promise<object|null>,
 *           progress?: {sent?: boolean} }} deps  progress = 누르기 요청을 보낸 순간 `sent`를 세우는 그릇(이 함수가 던져도 코어가 읽는다)
 * @returns {Promise<{kind:string, code?:string, raw?:string|null, reactionId?:number, boardId?:number, sent?:boolean, absent?:boolean}>}
 *   sent = 쓰기 요청을 보냈지만 결과를 확정하지 못했다(ClassNote에 반영됐을 수 있다)
 *   absent = 그 명의로 읽어 그 종류의 공감이 **없음을 확인했다**(누르기에서만 — '확인 필요' 표식을 내린다)
 */
export async function runReactionOnce(page, row, action, { mode, recheckMode = async () => mode, loadBoardChildren, loadFacts = null, progress = {} }) {
  const pre = preflightReactionRow({ mode, row });
  if (!pre.ok) return { kind: "blocked", code: pre.code };
  if (action !== "add" && action !== "remove") return { kind: "blocked", code: "invalid" };
  const postId = Number(row.classnote_post_id);
  const commentId = row.target_comment_id == null ? null : Number(row.target_comment_id);
  const authorName = String(row.author_label).trim();
  const { permit, post, out } = await confirmReplyTarget(page, reactionRowForGuard(row), { mode, loadBoardChildren, loadFacts, authorName });
  if (!permit) return out;
  const boardId = permit.boardId;
  const now = await readMine(page, { postId, commentId, authorName, post });
  if (!now.ok) return { kind: "retryable", code: now.code, raw: now.raw ?? null, boardId };
  const changed = { kind: "retryable", code: "mode_changed", boardId };
  const unsure = (res) => ({ kind: "retryable", code: "uncertain", raw: `HTTP ${res.status} ${res.detail ?? ""}`.trim(), boardId, sent: true });
  /** 쓰기 **뒤**의 다시 읽기 — 브라우저가 죽어 던져도 '못 읽음'으로 받는다(코어의 예외 처리로 새면 `sent` 표식을 잃는다). */
  const readAfterWrite = () =>
    readMine(page, { postId, commentId, authorName }).catch((e) => ({ ok: false, code: "reactions_unavailable", raw: String(e?.message ?? e).slice(0, 200) }));

  /** 그 번호의 공감을 풀고 **다시 읽어** 사라졌는지 확인한다 — 풀렸으면 null, 아니면 돌려줄 결과. */
  async function removeOne(reactionId, live) {
    const res = await sendSafely(() => deleteReaction(page, permit, { postId, commentId, reactionId, mode: live }));
    const verdict = classifyWriteStatus(res.status);
    if (verdict === "rejected" && res.status !== 404) return { kind: "blocked", code: "rejected", raw: res.detail, boardId };
    const again = await readAfterWrite();
    if (again.ok) return again.missing || !hasMyReaction(again.mine, reactionId) ? null : unsure(res);
    // 다시 못 읽었다 — 2xx면 풀린 것으로 믿고, 404·불확실은 확정하지 않는다(그 자리에 엔드포인트가 없었을 수도 있다).
    return verdict === "ok" ? null : { ...unsure(res), code: again.code };
  }

  if (action === "remove") {
    if (now.missing || !hasMyReaction(now.mine, row.classnote_reaction_id)) return { kind: "gone", code: "gone", boardId };
    const live = await liveModeFor(permit, recheckMode);
    if (!live) return changed;
    const left = await removeOne(row.classnote_reaction_id, live);
    return left ?? { kind: "done", reactionId: Number(row.classnote_reaction_id), boardId };
  }

  // 누르기 — 댓글 공감이면 그 댓글이 아직 있고(시험 보드가 아니면) 학부모가 쓴 것이어야 한다.
  if (now.missing) return { kind: "blocked", code: "comment_gone", boardId, absent: true };
  if (commentId != null && permit.basis !== "test" && now.authorType !== "parent") return { kind: "blocked", code: "not_parent_comment", boardId };
  const existing = findMyReaction(now.mine, row.reaction_type);
  if (existing) return { kind: "already", reactionId: existing, boardId };
  // 여기부터는 그 명의로 읽어 **그 종류가 없음을 확인한 뒤**다(absent) — 쓰기 전에 끝나는 결과는 '확인 필요' 표식을 내린다.
  // '확인 필요' 행은 읽기만 한다 — 눌리지 않았음을 확인했으니 표식을 내리고 끝낸다(다시 누르지 않는다).
  if (row.unconfirmed === true) return { kind: "blocked", code: "not_pressed", boardId, absent: true };
  if (isReactionExpired(row)) return { kind: "blocked", code: "expired", boardId, absent: true };
  const types = await listReactionTypes(page);
  if (!types.ok) return { kind: "retryable", code: "reactions_unavailable", raw: types.detail, boardId, absent: true };
  if (!types.types.includes(row.reaction_type)) return { kind: "blocked", code: "type_unknown", boardId, absent: true };
  const live = await liveModeFor(permit, recheckMode);
  if (!live) return { ...changed, absent: true };
  // 그 명의로 다른 종류가 눌려 있으면 먼저 푼다(메시지당 하나 — 앞선 시도의 잔재이거나 종류를 바꾸는 중이다).
  for (const other of now.mine) {
    if (other?.reaction_type === row.reaction_type || !Number.isFinite(Number(other?.id))) continue;
    const left = await removeOne(Number(other.id), live);
    if (left) return { ...left, sent: false, absent: true }; // 새 종류는 아직 누르지 않았다
  }
  progress.sent = true; // 이 줄 뒤로는 요청이 나갔을 수 있다(아래에서 던져도 코어가 '확인 필요'를 세운다)
  const res = await sendSafely(() => writeReaction(page, permit, { postId, commentId, mode: live }, { reaction_type: row.reaction_type, author_name: authorName }));
  const verdict = classifyWriteStatus(res.status);
  if (verdict === "rejected") return { kind: "blocked", code: "rejected", raw: res.detail, boardId, absent: true };
  if (verdict === "ok" && res.id) return { kind: "done", reactionId: res.id, boardId };
  // 번호를 못 받았거나 응답이 불확실하다 — 다시 읽어 그 명의의 공감이 생겼는지 본다.
  const again = await readAfterWrite();
  const made = again.ok ? findMyReaction(again.mine, row.reaction_type) : null;
  if (made) return { kind: verdict === "ok" ? "done" : "already", reactionId: made, boardId };
  // 다시 읽어 **없음을 확인했고** 응답도 실패였으면 눌리지 않은 것이다(absent). 다시 못 읽었거나 2xx인데 안 보이면 눌렸을 수 있다(sent).
  const maybe = !again.ok || verdict === "ok";
  return { ...unsure(res), code: again.ok ? "uncertain" : again.code, sent: maybe, absent: !maybe };
}
