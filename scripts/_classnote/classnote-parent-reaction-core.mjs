// scripts/_classnote/classnote-parent-reaction-core.mjs — 학부모 글·댓글 **공감** 큐(0319a) 처리(연동 PC 워커 · 개발 PC 1회 실행 공용).
//
// 앱(서버 액션)이 classnote_parent_reactions에 queued/remove_requested 행을 남기면, 이 코어가 **한 건씩** 집어 봇 계정 세션으로
// ClassNote 그 글(학부모 새 글) 또는 그 댓글(학부모 댓글)에 공감을 누르거나 푼다.
//
// 🔴 안전장치는 답글 큐(classnote-parent-reply-core.mjs)와 **같은 것**을 그대로 쓴다:
//   ① `--post` 워커만 · 모드(학원 설정 `report.classnoteParentReplyMode` — 폴마다 `loadReplyMode`로 다시 읽고, 끔이면 아무것도 집지 않는다)
//      · ClassNote 모듈 + 발송 스위치가 켜져 있을 때만.
//   ② 사전 판정에 걸리는 행은 ClassNote에 접속(로그인)조차 하지 않는다.
//   ③ 쓰기 직전 원글을 다시 읽어 대상을 확인하고(시험 보드 / 전체 모드의 확정 연결), 그 허가증 없이는 쓰기 함수가 요청을 보내지 않는다.
//   (④~ 는 parent-reaction-run.mjs `runReactionOnce` — 이미 눌려 있으면 쓰지 않는다 · 남의 공감은 풀지 않는다.)
// 표가 없으면(0319a 적용 전) 조용히 쉰다([[#95]]).
import { fetchBoardChildren, fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { isClassnoteSendEnabled } from "./classnote-core.mjs";
import { loadReplyFacts, loadReplyMode } from "./classnote-parent-reply-core.mjs";
import { REPLY_STALE_MIN } from "./parent-reply-guard.mjs";
import { preflightReactionRow, reactionErrorLabel, reactionNextState, reactionRowForGuard } from "./parent-reaction-guard.mjs";
import { runReactionOnce } from "./parent-reaction-run.mjs";

const MISSING_RECHECK_MS = 10 * 60_000;
let tableMissingAt = 0;
const isMissing = (e) => e?.code === "42P01" || /classnote_parent_reactions.*does not exist/i.test(String(e?.message ?? ""));
export const REACTION_AUDIT = { action: "classnote_parent_reaction_run", actor_name: "system:classnote-parent-reaction" };

// 멈춤 복구는 1분에 한 번(지점별) — 답글 큐와 같은 이유.
const SWEEP_EVERY_MS = 60_000;
const lastSweepAt = new Map();
const heldLogged = new Map();

async function sweep(sql, tenant, onlyId) {
  if (!onlyId) {
    if (Date.now() - (lastSweepAt.get(tenant) ?? 0) < SWEEP_EVERY_MS) return;
    lastSweepAt.set(tenant, Date.now());
  }
  const only = onlyId ? sql`and id = ${onlyId}` : sql``;
  // 누르기를 하다 멈춘 행은 요청이 나갔을 수 있다 — '확인 필요' 표식을 세워 되돌린다(그 사이 앱이 취소·덮어쓰기를 받지 않게).
  await sql`update classnote_parent_reactions set
      status = case processing_action when 'remove' then 'remove_requested' else 'queued' end,
      unconfirmed = case when processing_action = 'add' then true else unconfirmed end,
      processing_action = null, processing_at = null, updated_at = now()
    where tenant_id = ${tenant} and status = 'processing' ${only}
      and processing_at < now() - make_interval(secs => ${REPLY_STALE_MIN * 60})`;
}

async function claim(sql, tenant, host, onlyId) {
  const only = onlyId ? sql`and id = ${onlyId}` : sql``;
  const [row] = await sql`
    update classnote_parent_reactions r set status = 'processing',
      processing_action = case r.status when 'remove_requested' then 'remove' else 'add' end,
      processing_at = now(), worker_host = ${host}, updated_at = now()
    where r.id = (
      select id from classnote_parent_reactions
      where tenant_id = ${tenant} and status in ('queued', 'remove_requested') ${only}
      order by updated_at limit 1 for update skip locked)
      and r.status in ('queued', 'remove_requested')
    returning r.*`;
  return row ?? null;
}

/**
 * 결과를 행에 적는다(이 워커가 처리 중인 그 행만).
 * `unconfirmed` = 누르기 요청을 **보냈는데 결과를 확정하지 못했다**(ClassNote에 눌려 있을 수 있다). 확정되면 내린다 — 성공(눌림·이미 눌림·
 * 풀림)이거나, 그 명의로 읽어 **없음을 확인한 뒤** 끝난 결과(`absent`)일 때. 읽기도 전에 끝난 결과(가드 거절·원글 못 읽음)는 그대로 둔다.
 * 앱은 이 표식이 선 행을 취소하거나 다른 명의·종류로 덮어쓰지 않는다.
 */
async function writeResult(sql, row, action, r, host) {
  const status = reactionNextState({ action, kind: r.kind, retryCount: row.retry_count });
  const ok = r.kind === "done" || r.kind === "already" || (action === "remove" && r.kind === "gone");
  const err = ok ? null : reactionErrorLabel(r.code);
  const raw = ok ? null : r.raw ? String(r.raw).slice(0, 300) : null;
  const retryInc = r.kind === "retryable" ? 1 : 0;
  const added = action === "add" && ok;
  const updated = await sql`
    update classnote_parent_reactions set
      status = ${status}, processing_action = null, processing_at = null, worker_host = ${host}, updated_at = now(),
      error = ${err}, error_raw = ${raw}, failed_action = ${ok ? null : action},
      retry_count = case when ${ok}::boolean then 0 else retry_count + ${retryInc}::int end,
      unconfirmed = case when ${ok}::boolean then false when ${action === "add" && r.sent === true}::boolean then true
                         when ${action === "add" && r.absent === true}::boolean then false else unconfirmed end,
      board_id = coalesce(board_id, ${r.boardId ?? null}::bigint),
      classnote_reaction_id = case when ${added}::boolean then ${r.reactionId ?? null}::bigint
                                   when ${status === "removed"}::boolean then null else classnote_reaction_id end,
      reacted_at = case when ${added}::boolean then now() else reacted_at end,
      removed_at = case when ${status === "removed"}::boolean then now() else removed_at end
    where id = ${row.id} and status = 'processing' and worker_host = ${host}
    returning id`;
  return { status, ok, err, written: updated.length > 0 };
}

async function audit(sql, tenant, row, action, r, fin) {
  const verb = action === "add" ? "누름" : "풀기";
  const metadata = {
    reactionRowId: row.id, messageId: row.message_id ?? null, postId: Number(row.classnote_post_id),
    ...(row.target_comment_id != null ? { commentId: Number(row.target_comment_id) } : {}),
    action, ok: fin.ok, status: fin.status, kind: r.kind, ...(r.code ? { code: r.code } : {}), ...(fin.err ? { error: fin.err } : {}),
    ...(r.reactionId ? { reactionId: Number(r.reactionId) } : {}), ...(r.boardId ? { boardId: Number(r.boardId) } : {}),
    reactionType: row.reaction_type, author: row.author_label,
  };
  await sql`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
    values (${tenant}, null, ${REACTION_AUDIT.actor_name}, ${REACTION_AUDIT.action}, ${"classnote_parent_reaction"},
      ${`학부모 글 공감 ${verb}${fin.ok ? "" : " 실패"}`}, ${sql.json(metadata)})`.catch(() => {});
}

/** 폴 1회 — 할 일이 있으면 한 건 처리. `onlyId`면 그 행만(개발 PC 1회 실행). 반환 { ran, ok?, status? }. */
export async function processParentReactionsOnce(sql, browser, { tenant, post, host, log = console.log, onlyId = null }) {
  if (!post || (tableMissingAt && Date.now() - tableMissingAt < MISSING_RECHECK_MS)) return { ran: false };
  let row;
  let mode = "off";
  try {
    await sweep(sql, tenant, onlyId);
    const [{ n }] = await sql`select count(*)::int as n from classnote_parent_reactions
      where tenant_id = ${tenant} and status in ('queued', 'remove_requested')`;
    if (!n) {
      heldLogged.delete(tenant);
      return { ran: false };
    }
    // 모드는 폴마다 다시 읽는다(할 일이 있을 때만) — 끔이면 아무것도 집지 않는다(큐 보존 · 조용히).
    mode = await loadReplyMode(sql, tenant);
    if (mode === "off") return { ran: false };
    if (!(await isClassnoteSendEnabled(sql, tenant))) {
      if (heldLogged.get(tenant) !== n) log(`[reaction] 발송 스위치(또는 ClassNote 모듈)가 꺼져 공감 ${n}건 보류(큐 보존)`);
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
  const progress = { sent: false }; // 누르기 요청을 보낸 순간 실행 모듈이 세운다 — 그 뒤 던져도 '확인 필요' 표식을 세울 수 있게
  let r;
  try {
    // 가드에 걸리는 행은 ClassNote에 접속(로그인)조차 하지 않는다.
    const pre = preflightReactionRow({ mode, row });
    if (!pre.ok) r = { kind: "blocked", code: pre.code };
    else {
      const page = await browser.newPage();
      try {
        await loginClassnote(page);
        const centerId = await fetchCenterId(page);
        r = await runReactionOnce(page, row, action, {
          mode,
          recheckMode: () => loadReplyMode(sql, tenant),
          loadBoardChildren: (boardId) => fetchBoardChildren(page, centerId, boardId),
          loadFacts: (boardId) => loadReplyFacts(sql, tenant, reactionRowForGuard(row), boardId),
          progress,
        });
      } finally {
        await page.close().catch(() => {});
      }
    }
  } catch (e) {
    r = e?.code === "REPLY_WRITE_GUARD"
      ? { kind: "blocked", code: "write_guard", raw: String(e.message ?? "") }
      : { kind: "retryable", code: "uncertain", raw: String(e?.message ?? e), sent: progress.sent };
  }
  const fin = await writeResult(sql, row, action, r, host);
  await audit(sql, tenant, row, action, r, fin);
  log(`[reaction] ${row.id} ${action} → ${fin.status}${fin.err ? ` (${fin.err}${r.raw ? ` · ${String(r.raw).slice(0, 120)}` : ""})` : ""}${r.reactionId ? ` · 공감 ${r.reactionId}` : ""}`);
  return { ran: true, ok: fin.ok, status: fin.status, kind: r.kind, code: r.code ?? null, reactionId: r.reactionId ?? null };
}
