// scripts/_classnote/parent-reply-guard.mjs — 학부모 글·댓글 **답글**(0317a) 워커 판정(순수, Vitest).
//
// 원장 2026-09-30 *"이전 1인 반에서 작동하는 기능을 반 기준으로 바꿔도 작동하게"* — aywa에서 쓴 답글을 연동 PC 워커가
// 봇 계정으로 ClassNote 그 글에 **댓글**로 올린다(게시·수정·삭제). 여기는 "올려도 되나 · 이미 올렸나 · 다음 상태" 판정만.
// ⚠️ 의존성 0 — playwright·postgres를 import하지 말 것(테스트가 끌어오면 안 된다).
//
// 🔴 dev 단계 하드 가드(원장 2026-09-30 *"학원이 계정으로 테스트, dev에서 철저히 구현하고 밀어야"*):
//    `REPLY_MODE`는 코드 상수 "test"다 — **학원이 테스트 보드 두 개 + 원아 5268389**가 아니면 쓰기·수정·삭제를 전부 거절한다.
//    설정 모드(꺼짐/테스트/시범 강사/켜짐, 기본 꺼짐)로 바꾸는 건 main 반영 단계 — 그때 `pilot`·`on`에 반 보드 매칭(0302a)·
//    1인 보드 게이트(board-safety)를 이 파일의 `evaluateReplyTarget`에 붙인다. 지금은 두 모드 모두 `mode_not_ready`로 거절.
// 🔴 앱(src/features/classnote-reply/reply-policy.ts)이 같은 상수를 한 벌 더 든다(런타임이 달라서) —
//    한쪽을 바꾸면 다른 쪽도(가드: reply-guard-parity.test.ts가 두 파일의 값을 대조한다).

export const REPLY_BODY_MAX = 1000;
export const REPLY_AUTHOR_MAX = 60;
export const REPLY_MODES = Object.freeze(["off", "test", "pilot", "on"]);
/** 🔴 하드 가드 — 설정으로 바꾸지 않는다(dev 단계). */
export const REPLY_MODE = "test";
export const REPLY_TEST_TARGETS = Object.freeze({
  boards: Object.freeze([
    Object.freeze({ id: 1317083, name: "[수학] 테스트반" }),
    Object.freeze({ id: 1291581, name: "(수학)학원이" }),
  ]),
  childIds: Object.freeze([5268389]),
});
/** 결과가 불확실한 쓰기(5xx·끊김)의 재시도 상한 — 매번 **다시 읽어 없을 때만** 다시 쓴다. */
export const REPLY_RETRY_MAX = 3;
/** processing이 이만큼 지나면 멈춘 것으로 보고 요청 상태로 되돌린다(분). 되돌린 행도 게시 전 재조회를 거친다. */
export const REPLY_STALE_MIN = 15;
/**
 * 새 답글(게시)은 요청한 지 이만큼(시간) 지나면 올리지 않는다 — 발송 스위치를 며칠 내렸다 올리거나 연동 PC가 오래 꺼져 있던 뒤에
 * 묵은 답글("네 내일 뵙겠습니다")이 뒤늦게 학부모에게 나가는 것을 막는다. 수정·삭제 요청엔 걸지 않는다(이미 나간 댓글의 수습).
 */
export const REPLY_POST_MAX_AGE_HOURS = 24;

/** 학원이 테스트 보드의 학원이 글인가 — 보드와 원아가 **둘 다** 맞아야 한다. */
export function isReplyTestTarget({ boardId, childId }) {
  const b = Number(boardId);
  const c = Number(childId);
  return REPLY_TEST_TARGETS.boards.some((x) => x.id === b) && REPLY_TEST_TARGETS.childIds.includes(c);
}

/** 테스트 보드의 지금 원아가 전부 `학원*` 테스트 원아인가(class-notice-guard `isTestOnlyBoard`와 같은 규칙). */
export function isTestOnlyChildren(live) {
  return Array.isArray(live) && live.length > 0 && live.every((m) => String(m?.name ?? "").startsWith("학원"));
}

const toNum = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * ClassNote를 **읽기도 전에** — 요청 행만 보고 지금 모드에서 손댈 수 있는 자리인가.
 * test 모드는 행에 적힌 보드·원아가 테스트 목록이어야 한다(서버가 테스트 대상이면 보드 번호를 채워 넣는다) —
 * 그래야 다른 보드의 글을 조사 목적 없이 GET하지 않는다. 본문·작성자 이름도 여기서 한 번 더 본다.
 */
export function preflightReplyRow({ mode = REPLY_MODE, row }) {
  if (!REPLY_MODES.includes(mode) || mode === "off") return { ok: false, code: "mode_off" };
  const action = row?.processing_action ?? "post";
  const body = normalizeReplyText(action === "edit" ? row?.pending_body : row?.body);
  if (!body || body.length > REPLY_BODY_MAX) return { ok: false, code: "invalid" };
  const author = String(row?.author_label ?? "").trim();
  if (!author || author.length > REPLY_AUTHOR_MAX) return { ok: false, code: "invalid" };
  if (!Number.isFinite(Number(row?.classnote_post_id)) || Number(row.classnote_post_id) <= 0) return { ok: false, code: "invalid" };
  if (action !== "post" && !Number.isFinite(toNum(row?.classnote_comment_id))) return { ok: false, code: "gone" };
  if (mode === "test" && !isReplyTestTarget({ boardId: row?.board_id, childId: row?.child_id })) return { ok: false, code: "not_test_target" };
  if (mode === "pilot" || mode === "on") return { ok: false, code: "mode_not_ready" };
  return { ok: true };
}

/**
 * 묵은 게시 요청인가(`REPLY_POST_MAX_AGE_HOURS`). 워커가 집은 행엔 created_at이 항상 있다(not null) — 값이 없거나 읽을 수 없으면
 * 묵은 것으로 본다(모르면 올리지 않는다). 🔴 이 판정은 **"이미 올라가 있나" 확인 뒤, 쓰기 직전**에 건다 — 게시는 됐는데 기록 전에
 * 워커가 죽고 오래 꺼져 있던 행을 "올리지 못함"으로 적으면 ClassNote에 있는 댓글을 aywa가 모르게 된다(수정·삭제 불가).
 */
export function isReplyPostExpired(row, now = Date.now()) {
  const at = row?.created_at == null ? NaN : new Date(row.created_at).getTime();
  return !Number.isFinite(at) || now - at > REPLY_POST_MAX_AGE_HOURS * 3_600_000;
}

/**
 * 게시·수정·삭제 직전 — ClassNote에서 **다시 읽은 글**이 요청 때와 같은 자리인가, 지금 모드에서 허락된 자리인가.
 * @param {{ mode?: string, row: {board_id?:number|null, child_id?:number|null, classnote_post_id?:number|string|null}, post: {status:number, cls?:unknown, child?:unknown}|null,
 *           boardChildren?: Array<{id:number, name?:string}>|null }} p
 * @returns {{ ok: true, boardId: number, childId: number, postId: number|null } | { ok: false, code: string, retry: boolean }}
 */
export function evaluateReplyTarget({ mode = REPLY_MODE, row, post, boardChildren = null }) {
  if (!REPLY_MODES.includes(mode) || mode === "off") return { ok: false, code: "mode_off", retry: false };
  if (!post || post.status !== 200) {
    return post?.status === 404 ? { ok: false, code: "post_gone", retry: false } : { ok: false, code: "post_unavailable", retry: true };
  }
  const boardId = toNum(post.cls);
  const childId = toNum(post.child);
  if (!Number.isFinite(boardId)) return { ok: false, code: "post_unavailable", retry: true };
  if (toNum(row?.board_id) !== null && toNum(row.board_id) !== boardId) return { ok: false, code: "board_mismatch", retry: false };
  if (toNum(row?.child_id) !== null && toNum(row.child_id) !== childId) return { ok: false, code: "child_mismatch", retry: false };
  if (mode === "test") {
    if (!isReplyTestTarget({ boardId, childId })) return { ok: false, code: "not_test_target", retry: false };
    if (!Array.isArray(boardChildren)) return { ok: false, code: "board_check_failed", retry: true };
    if (!isTestOnlyChildren(boardChildren)) return { ok: false, code: "test_board_polluted", retry: false };
    return { ok: true, boardId, childId, postId: toNum(row?.classnote_post_id) }; // = 쓰기 허가증(assertReplyWritePermit)
  }
  // pilot·on — main 반영 단계에서 반 보드 매칭(0302a)·1인 보드 게이트를 여기에 붙인다. 그 전엔 절대 통과시키지 않는다.
  return { ok: false, code: "mode_not_ready", retry: false };
}

/**
 * 🔴 **쓰기 직전 마지막 문** — ClassNote에 쓰는 함수(parent-reply-api `writeComment`·`deleteComment`)가 요청을 보내기 전에 부른다.
 * `evaluateReplyTarget`이 통과시킨 결과(허가증)가 아니면 던진다. 모드는 **이 파일의 상수**만 본다(인자로 못 바꾼다) —
 * 호출부가 사전 판정·재대조를 빼먹거나 다른 모드를 넘겨도 dev 단계엔 학원이 테스트 보드의 학원이 글이 아니면 요청이 나가지 않는다.
 * pilot·on을 여는 날엔 이 함수에도 그 모드의 조건을 같이 적어야 한다(안 적으면 전부 막힌다 = 안전한 쪽).
 */
export function assertReplyWritePermit(permit, postId) {
  const fail = (why) => {
    throw replyWriteGuardError(why);
  };
  if (!permit || permit.ok !== true) fail("대상 확인(evaluateReplyTarget)을 통과하지 않았습니다");
  // 허가증은 **그 글** 것이다 — 다른 글 번호로 쓰려 하면 거절(확인한 글과 쓰는 글이 갈라지지 않게).
  if (!Number.isFinite(toNum(postId)) || toNum(permit.postId) !== toNum(postId)) fail("확인한 글과 쓰려는 글이 다릅니다");
  if (!Number.isFinite(toNum(permit.boardId)) || !Number.isFinite(toNum(permit.childId))) fail("보드·원아를 확인하지 못했습니다");
  if (REPLY_MODE !== "test") fail(`모드 ${REPLY_MODE}는 아직 쓰기를 열지 않았습니다`);
  if (!isReplyTestTarget({ boardId: permit.boardId, childId: permit.childId })) fail("학원이 테스트 보드의 학원이 글이 아닙니다");
  return true;
}

/** 쓰기 가드가 막았다는 오류 — 코어가 `code`로 알아보고 재시도 없이 실패로 적는다(다시 해도 같은 결과다). */
export function replyWriteGuardError(why) {
  const e = new Error(`답글 쓰기 가드: ${why}`);
  e.code = "REPLY_WRITE_GUARD";
  return e;
}

/** 댓글 본문 비교용 정규화 — 줄바꿈 표기와 앞뒤 공백만(내용은 그대로). */
export function normalizeReplyText(s) {
  return String(s ?? "").replace(/\r\n?/g, "\n").trim();
}

/** 같은 글인가 — 줄 끝 공백·줄바꿈 표기만 다르면 같다고 본다(ClassNote가 저장하며 다듬는 정도). 내용이 다르면 다르다. */
export function sameReplyText(a, b) {
  const tidy = (s) => normalizeReplyText(s).split("\n").map((l) => l.replace(/[ \t]+$/, "")).join("\n");
  return tidy(a) === tidy(b);
}

/**
 * 같은 글에 **같은 본문의 봇 댓글**이 이미 있나(크래시·멈춤 복구 뒤 중복 게시 방지). 학부모 댓글은 제외.
 * `author_name`이 응답에 있으면 그것까지 맞아야 한다. 여럿이면 가장 최근(id 큰) 것.
 * @returns {number|null} 댓글 id
 */
export function findExistingReplyComment(comments, { body, authorName }) {
  const want = normalizeReplyText(body);
  if (!want) return null;
  const hits = (Array.isArray(comments) ? comments : []).filter((c) => {
    if (!c || c.author?.type === "parent") return false;
    if (!sameReplyText(c.content, want)) return false;
    return authorMatches(c, authorName);
  });
  const ids = hits.map((c) => Number(c.id)).filter(Number.isFinite);
  return ids.length ? Math.max(...ids) : null;
}

function authorMatches(c, authorName) {
  const name = c.author_name ?? c.author?.name;
  return name == null || !authorName || String(name).trim() === String(authorName).trim();
}

/**
 * 방금 보낸 게시 요청이 **만든 댓글** 찾기 — 쓰기 전 목록(`before`)과 쓰기 뒤 목록(`after`)을 대조한다.
 *   ① 같은 본문의 봇 댓글(`findExistingReplyComment`)
 *   ② 없으면 **쓰기 전엔 없던** 봇 댓글(같은 게시 명의) 가운데 — 응답이 준 댓글 번호와 같은 것, 또는 공백만 다른 것 하나.
 *      ClassNote가 본문을 다듬어 저장해 글자가 안 맞는 경우다.
 * 🔴 ②가 없으면 "2xx를 받았는데 같은 글자를 못 찾았다 → 다시 게시"가 되어 **같은 답글이 최대 3번** 학부모에게 나간다.
 * 🔴 "새로 생긴 봇 댓글이 하나뿐이니 그것"으로 넓히지 않는다 — 그 사이 사람이 ClassNote에서 직접 단 댓글을 우리 것으로 적으면
 *    답글은 안 나갔는데 '게시됨'이 된다. 번호나 글자라는 **증거가 있을 때만** 고른다(없으면 null = 결과 모름).
 * @returns {number|null}
 */
export function resolvePostedComment({ before, after, body, authorName, responseId = null }) {
  const exact = findExistingReplyComment(after, { body, authorName });
  if (exact) return exact;
  const seen = new Set((Array.isArray(before) ? before : []).map((c) => Number(c?.id)));
  const fresh = (Array.isArray(after) ? after : []).filter(
    (c) => c && c.author?.type !== "parent" && Number.isFinite(Number(c.id)) && !seen.has(Number(c.id)) && authorMatches(c, authorName),
  );
  const rid = toNum(responseId);
  if (rid !== null && fresh.some((c) => Number(c.id) === rid)) return rid;
  const squash = (s) => String(s ?? "").replace(/\s+/g, "");
  const want = squash(body);
  const loose = want ? fresh.filter((c) => squash(c.content) === want) : [];
  return loose.length === 1 ? Number(loose[0].id) : null;
}

/** 수정·삭제 대상 댓글 — 번호가 같고 **학부모 것이 아닌** 댓글만. 없으면 null. */
export function findOwnComment(comments, commentId) {
  const id = Number(commentId);
  return (Array.isArray(comments) ? comments : []).find((c) => Number(c?.id) === id && c?.author?.type !== "parent") ?? null;
}

/** 쓰기 요청 본문 — 잘못된 값이면 던진다(빈 본문·길이 초과가 ClassNote로 나가지 않게). */
export function buildReplyPayload({ authorName, body }) {
  const author = String(authorName ?? "").trim();
  const content = normalizeReplyText(body);
  if (!author || author.length > REPLY_AUTHOR_MAX) throw new Error("답글 작성자 이름이 비었거나 너무 깁니다");
  if (!content || content.length > REPLY_BODY_MAX) throw new Error(`답글 본문이 비었거나 ${REPLY_BODY_MAX}자를 넘습니다`);
  return { author_name: author, content, attached_images: [], attached_video: null, attached_files: [], emoticon_content: null };
}

/** HTTP 상태 → ok | rejected(확실히 안 됨) | uncertain(됐을 수도 있다 — 다시 읽어 본다). */
export function classifyWriteStatus(status) {
  const s = Number(status);
  if (s >= 200 && s < 300) return "ok";
  if (!s || s === 401 || s === 403 || s === 408 || s === 429 || s >= 500) return "uncertain";
  return "rejected";
}

/** 처리 중(processing) 행이 멈췄을 때 되돌릴 요청 상태. */
export function staleReturnStatus(action) {
  return action === "edit" ? "edit_requested" : action === "delete" ? "delete_requested" : "queued";
}

/**
 * 한 번 처리한 뒤의 상태.
 * kind: done(했다) · already(이미 되어 있었다) · gone(대상 댓글이 없다) · rejected · blocked(가드) · retryable(다시 읽어 없음을 확인함)
 * 🔴 수정·삭제 실패는 댓글이 **그대로 게시돼 있다**는 뜻이라 success로 돌린다(사유는 error 칸).
 */
export function replyNextState({ action, kind, retryCount = 0 }) {
  const again = kind === "retryable" && retryCount + 1 < REPLY_RETRY_MAX;
  if (action === "post") {
    if (kind === "done" || kind === "already") return "success";
    return again ? "queued" : "failed";
  }
  if (action === "delete") {
    if (kind === "done" || kind === "already" || kind === "gone") return "deleted";
    return again ? "delete_requested" : "success";
  }
  if (kind === "done" || kind === "already") return "success";
  if (kind === "gone") return "deleted";
  return again ? "edit_requested" : "success";
}

const LABELS = {
  mode_off: "답글 기능이 꺼져 있습니다",
  mode_not_ready: "아직 이 보드에는 답글을 올릴 수 없습니다(시험 단계)",
  not_test_target: "시험 단계라 학원이 테스트 보드의 학원이 글에만 답글을 올립니다",
  test_board_polluted: "테스트 보드에 학원* 테스트 원아가 아닌 원아가 있어 올리지 않았습니다",
  board_mismatch: "원글의 보드가 요청 때와 달라 올리지 않았습니다",
  child_mismatch: "원글의 원아가 요청 때와 달라 올리지 않았습니다",
  post_gone: "원글이 ClassNote에서 지워져 답글을 올릴 수 없습니다",
  post_unavailable: "ClassNote에서 원글을 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  board_check_failed: "보드 원아를 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  comments_unavailable: "ClassNote 댓글 목록을 확인하지 못했습니다 — 잠시 뒤 다시 시도합니다",
  rejected: "ClassNote가 요청을 거부했습니다",
  uncertain: "ClassNote 응답이 불확실해 다시 확인 후 재시도합니다",
  gone: "ClassNote에서 이미 지워진 댓글입니다",
  not_ours: "ClassNote 댓글이 aywa 기록과 달라 손대지 않았습니다(ClassNote에서 직접 고쳤을 수 있습니다)",
  invalid: "답글 내용이 올바르지 않습니다",
  write_guard: "쓰기 가드가 막았습니다 — 시험 단계 대상(학원이 테스트 보드의 학원이 글)이 아닙니다",
  expired: "요청한 지 하루가 넘어 올리지 않았습니다 — 필요하면 다시 써 주세요",
  duplicate_body: "같은 글에 같은 내용의 답글이 이미 있어 고치지 않았습니다",
  record_conflict: "ClassNote 댓글은 고쳤지만 같은 내용의 답글이 이미 있어 aywa 기록을 바꾸지 못했습니다 — ClassNote에서 확인하세요",
  retry_exhausted: "여러 번 시도했지만 올리지 못했습니다",
};

/** 한글 사유(화면·error 칸). 원문은 error_raw로 따로 적는다. */
export function replyErrorLabel(code) {
  return LABELS[code] ?? "답글을 처리하지 못했습니다";
}
