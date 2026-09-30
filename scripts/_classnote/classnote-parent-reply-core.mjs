// scripts/_classnote/classnote-parent-reply-core.mjs — 학부모 글·댓글 **답글** 큐(0317a) 처리(연동 PC 워커 · 개발 PC 1회 실행 공용).
//
// 앱(서버 액션)이 classnote_parent_replies에 queued/edit_requested/delete_requested 행을 남기면, 이 코어가 **한 건씩** 집어
// 봇 계정(CLASSNOTE_UPLOAD_ID, 관리자) 세션으로 ClassNote 그 글에 댓글을 게시·수정·삭제한다.
//
// 🔴 안전장치(전부 매번):
//   ① `--post` 워커만 · ClassNote 모듈 켜짐 + 발송 스위치(classnoteSendEnabled) 켜짐일 때만 집는다(킬스위치를 따른다).
//   ② 모드 가드(parent-reply-guard.mjs) — dev 단계는 **학원이 테스트 보드 두 개 + 원아 5268389**만. 그 밖이면 ClassNote에
//      **접속(로그인)조차 하지 않는다**(`precheck`). 하루 넘게 묵은 게시 요청은 올리지 않는다(이미 올라가 있는지 확인한 뒤에).
//   (③~⑥은 parent-reply-run.mjs `runReplyOnce` — ClassNote 쓰기는 그 함수에서만 일어난다.)
//   ③ 쓰기 직전 **원글을 다시 읽어** 보드·원아를 요청과 대조하고, 테스트 보드의 지금 원아가 전부 학원*인지 본다.
//      그 결과(허가증)를 쓰기 함수에 넘긴다 — 쓰기 함수가 요청 직전에 다시 확인한다(parent-reply-api `assertReplyWritePermit`).
//   ④ 게시 직전 그 글의 댓글을 다시 읽어 **같은 본문의 봇 댓글**이 있으면 올리지 않고 성공으로 적는다(멈춤 복구·재시도 중복 방지).
//   ⑤ 게시 뒤엔 응답만 믿지 않고 **다시 읽어** 확인한다 — 같은 본문이 없으면 **쓰기 전엔 없던 봇 댓글**(응답의 댓글 번호)을 찾는다.
//      ClassNote가 본문을 다듬어 저장해 글자가 안 맞아도 "못 찾았다 → 다시 게시"가 되지 않게(같은 답글이 세 번 나가는 길).
//      응답이 불확실하고(5xx·끊김) 새 댓글도 없을 때만 재시도한다 — 다시 못 읽으면 쓰지 않는다(fail-closed).
//   ⑥ 수정·삭제는 번호가 같고 학부모 것이 아니며 내용이 aywa 기록과 같은 댓글만(누가 ClassNote에서 고쳤으면 손대지 않는다).
// 표가 없으면(0317a 적용 전) 조용히 쉰다([[#95]]).
import { fetchBoardChildren, fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { isClassnoteSendEnabled } from "./classnote-core.mjs";
import { REPLY_MODE, REPLY_STALE_MIN, normalizeReplyText, preflightReplyRow, replyErrorLabel, replyNextState } from "./parent-reply-guard.mjs";
import { runReplyOnce } from "./parent-reply-run.mjs";

const MISSING_RECHECK_MS = 10 * 60_000;
let tableMissingAt = 0;
const isMissing = (e) => e?.code === "42P01" || /classnote_parent_replies.*does not exist/i.test(String(e?.message ?? ""));
export const REPLY_AUDIT = { action: "classnote_parent_reply_run", actor_name: "system:classnote-parent-reply" };
const LIVE = ["queued", "processing", "success", "edit_requested", "delete_requested"];

// 멈춤 복구는 1분에 한 번(지점별) — 데몬 폴은 15초라 매번 돌리면 쓸모없는 UPDATE만 쌓인다(classnote-core STALE_SWEEP_MS와 같은 이유).
const SWEEP_EVERY_MS = 60_000;
const lastSweepAt = new Map();
// 발송 스위치가 꺼져 보류 중이라는 안내는 **건수가 바뀔 때만** 남긴다(15초 폴마다 찍으면 하루 5,760줄).
const heldLogged = new Map();

/** `onlyId`(1회 실행)면 그 행만 되돌린다 — 그 스크립트는 다른 행을 건드리지 않는다. */
async function sweep(sql, tenant, onlyId) {
  if (!onlyId) {
    if (Date.now() - (lastSweepAt.get(tenant) ?? 0) < SWEEP_EVERY_MS) return;
    lastSweepAt.set(tenant, Date.now());
  }
  const only = onlyId ? sql`and id = ${onlyId}` : sql``;
  await sql`update classnote_parent_replies set
      status = case processing_action when 'edit' then 'edit_requested' when 'delete' then 'delete_requested' else 'queued' end,
      processing_action = null, processing_at = null, updated_at = now()
    where tenant_id = ${tenant} and status = 'processing' ${only}
      and processing_at < now() - make_interval(secs => ${REPLY_STALE_MIN * 60})`;
}

async function claim(sql, tenant, host, onlyId) {
  const only = onlyId ? sql`and id = ${onlyId}` : sql``;
  const [row] = await sql`
    update classnote_parent_replies r set status = 'processing',
      processing_action = case r.status when 'edit_requested' then 'edit' when 'delete_requested' then 'delete' else 'post' end,
      processing_at = now(), worker_host = ${host}, updated_at = now()
    where r.id = (
      select id from classnote_parent_replies
      where tenant_id = ${tenant} and status in ('queued', 'edit_requested', 'delete_requested') ${only}
      order by updated_at limit 1 for update skip locked)
      and r.status in ('queued', 'edit_requested', 'delete_requested')
    returning r.*`;
  return row ?? null;
}

/**
 * ClassNote에 **접속하기 전** 판정 — 가드 거절(모드·테스트 대상 아님·잘못된 값)과, 수정이면 같은 글의 다른 살아 있는
 * 답글과 본문이 같아지는지(같아지면 ClassNote만 고쳐지고 aywa 기록은 유니크에 걸려 못 바꾼다). 걸리면 결과를, 아니면 null.
 */
async function precheck(sql, tenant, row, action) {
  const pre = preflightReplyRow({ mode: REPLY_MODE, row });
  if (!pre.ok) return { kind: "blocked", code: pre.code };
  if (action === "edit") {
    const want = normalizeReplyText(row.pending_body);
    const [dup] = await sql`select id from classnote_parent_replies
      where tenant_id = ${tenant} and classnote_post_id = ${row.classnote_post_id} and id <> ${row.id}
        and status in ${sql(LIVE)} and (body = ${want} or pending_body = ${want}) limit 1`;
    if (dup) return { kind: "blocked", code: "duplicate_body" };
  }
  return null;
}

/** 같은 글의 **다른 답글 행이 이미 제 것으로 적은** 댓글 번호 — 그 댓글을 이 행의 것으로 또 적지 않는다. */
async function claimedCommentIds(sql, tenant, row) {
  const rows = await sql`select classnote_comment_id from classnote_parent_replies
    where tenant_id = ${tenant} and classnote_post_id = ${row.classnote_post_id} and id <> ${row.id}
      and classnote_comment_id is not null and status <> 'deleted'`;
  return new Set(rows.map((r) => Number(r.classnote_comment_id)));
}

/** 결과를 행에 적는다(이 워커가 처리 중인 그 행만 — 그 사이 멈춤 복구돼 다른 워커가 집었으면 0행). */
async function writeResult(sql, row, action, r, host) {
  const status = replyNextState({ action, kind: r.kind, retryCount: row.retry_count });
  const ok = r.kind === "done" || r.kind === "already" || (action === "delete" && r.kind === "gone");
  const err = ok ? null : replyErrorLabel(r.code);
  const raw = ok ? null : r.raw ? String(r.raw).slice(0, 300) : null;
  const retryInc = r.kind === "retryable" ? 1 : 0;
  const boardId = r.boardId ?? null;
  const editDone = action === "edit" && (r.kind === "done" || r.kind === "already");
  const history = editDone ? sql.json([{ body: row.body, replaced_at: new Date().toISOString(), by: row.last_action_by ?? null }]) : null;
  const updated = await sql`
    update classnote_parent_replies set
      status = ${status}, processing_action = null, processing_at = null, worker_host = ${host}, updated_at = now(),
      error = ${err}, error_raw = ${raw}, failed_action = ${ok ? null : action},
      retry_count = case when ${ok}::boolean then 0 else retry_count + ${retryInc}::int end,
      board_id = coalesce(board_id, ${boardId}::bigint),
      classnote_comment_id = case when ${action === "post" && ok}::boolean then ${r.commentId ?? null}::bigint else classnote_comment_id end,
      posted_at = case when ${action === "post" && ok}::boolean then now() else posted_at end,
      edit_history = case when ${editDone}::boolean then edit_history || ${history ?? sql.json([])} else edit_history end,
      body = case when ${editDone}::boolean then pending_body else body end,
      pending_body = case when ${status === "edit_requested"}::boolean then pending_body else null end,
      edited_at = case when ${editDone}::boolean then now() else edited_at end,
      deleted_at = case when ${status === "deleted"}::boolean then now() else deleted_at end
    where id = ${row.id} and status = 'processing' and worker_host = ${host}
    returning id`;
  return { status, ok, err, written: updated.length > 0 };
}

/**
 * 결과 기록. 수정이 ClassNote엔 반영됐는데 aywa 본문을 바꾸면 '같은 글·같은 본문' 유니크(23505)에 걸리는 경우
 * (사전 확인과 기록 사이에 같은 본문의 답글이 들어왔다) — 그대로 던지면 행이 processing에 멈췄다가 15분마다 같은 자리에서
 * 또 걸린다. 본문은 옛것으로 두고 사유를 남겨 끝낸다(사람이 ClassNote에서 확인).
 */
async function finish(sql, row, action, r, host) {
  try {
    return await writeResult(sql, row, action, r, host);
  } catch (e) {
    if (e?.code !== "23505" || action !== "edit") throw e;
    return writeResult(sql, row, action, { ...r, kind: "blocked", code: "record_conflict", raw: String(e.message ?? "") }, host);
  }
}

async function audit(sql, tenant, row, action, r, fin) {
  const verb = action === "post" ? "게시" : action === "edit" ? "수정" : "삭제";
  const metadata = {
    replyId: row.id, messageId: row.message_id ?? null, postId: Number(row.classnote_post_id), action, ok: fin.ok,
    status: fin.status, kind: r.kind, ...(r.code ? { code: r.code } : {}), ...(fin.err ? { error: fin.err } : {}), ...(r.commentId ? { commentId: Number(r.commentId) } : {}),
    ...(r.boardId ? { boardId: Number(r.boardId) } : {}), author: row.author_label,
  };
  await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
    values (${tenant}, null, ${REPLY_AUDIT.actor_name}, ${REPLY_AUDIT.action}, ${"classnote_parent_reply"},
      ${`학부모 답글 ${verb}${fin.ok ? "" : " 실패"}`}, ${sql.json(metadata)})`.catch(() => {});
}

/**
 * 폴 1회 — 할 일이 있으면 한 건 처리. `onlyId`면 그 행만(개발 PC 1회 실행). 반환 { ran, ok?, status?, summary? }.
 */
export async function processParentRepliesOnce(sql, browser, { tenant, post, host, log = console.log, onlyId = null }) {
  if (!post || (tableMissingAt && Date.now() - tableMissingAt < MISSING_RECHECK_MS)) return { ran: false };
  let row;
  try {
    await sweep(sql, tenant, onlyId);
    const [{ n }] = await sql`select count(*)::int as n from classnote_parent_replies
      where tenant_id = ${tenant} and status in ('queued', 'edit_requested', 'delete_requested')`;
    if (!n) {
      heldLogged.delete(tenant);
      return { ran: false };
    }
    if (!(await isClassnoteSendEnabled(sql, tenant))) {
      if (heldLogged.get(tenant) !== n) log(`[reply] 발송 스위치(또는 ClassNote 모듈)가 꺼져 답글 ${n}건 보류(큐 보존)`);
      heldLogged.set(tenant, n);
      return { ran: false };
    }
    heldLogged.delete(tenant);
    row = await claim(sql, tenant, host, onlyId);
  } catch (e) {
    if (isMissing(e)) {
      tableMissingAt = Date.now();
      return { ran: false };
    }
    throw e;
  }
  tableMissingAt = 0;
  if (!row) return { ran: false };
  const action = row.processing_action;
  let r;
  try {
    // 가드에 걸리는 행은 ClassNote에 접속(로그인)조차 하지 않는다.
    r = await precheck(sql, tenant, row, action);
    if (!r) {
      const claimed = await claimedCommentIds(sql, tenant, row);
      const page = await browser.newPage();
      try {
        await loginClassnote(page);
        const centerId = await fetchCenterId(page);
        // ClassNote 쓰기는 runReplyOnce 안에서만 — 가드(사전 판정 → 원글 재대조 → 쓰기 허가증)를 전부 거친다.
        r = await runReplyOnce(page, row, action, { claimed, loadBoardChildren: (boardId) => fetchBoardChildren(page, centerId, boardId) });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    // 쓰기 가드가 막은 것은 다시 해도 같다 — 재시도 없이 실패로. 그 밖(끊김·브라우저 오류)은 결과를 모르니 다시 읽어 판정.
    r = e?.code === "REPLY_WRITE_GUARD"
      ? { kind: "blocked", code: "write_guard", raw: String(e.message ?? "") }
      : { kind: "retryable", code: "uncertain", raw: String(e?.message ?? e) };
  }
  const fin = await finish(sql, row, action, r, host);
  await audit(sql, tenant, row, action, r, fin);
  log(`[reply] ${row.id} ${action} → ${fin.status}${fin.err ? ` (${fin.err}${r.raw ? ` · ${String(r.raw).slice(0, 120)}` : ""})` : ""}${r.commentId ? ` · 댓글 ${r.commentId}` : ""}`);
  return { ran: true, ok: fin.ok, status: fin.status, kind: r.kind, code: r.code ?? null, commentId: r.commentId ?? null };
}
