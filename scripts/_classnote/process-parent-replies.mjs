// scripts/_classnote/process-parent-replies.mjs — 학부모 답글(0317a) **한 건** 처리(개발 PC 시험·연동 PC 수동 복구용).
//
//   node --env-file=.env.local scripts/_classnote/process-parent-replies.mjs --id <답글 id>            # 점검(쓰기 0, ClassNote 접속 0)
//   node --env-file=.env.local scripts/_classnote/process-parent-replies.mjs --id <답글 id> --check    # + ClassNote 읽기만(GET)
//   node --env-file=.env.local scripts/_classnote/process-parent-replies.mjs --id <답글 id> --post     # 그 한 건만 실제 처리
//
// 🔴 하트비트(classnote_workers)를 쓰지 않는다 — 실게시 임대(worker-lease.mjs)는 데몬만의 것이다. 이 스크립트가 하트비트를
//    쓰면 연동 PC 대신 주인이 되거나, 앱이 "답글 받을 PC가 있다"고 오판한다.
// 🔴 지점은 그 행의 tenant_id로 정한다(그 행 하나만 집는다 — 다른 지점·다른 행은 건드리지 않는다).
// 🔴 모드는 그 지점의 학원 설정(끔·시험·전체)을 DB에서 읽는다 — 이 스크립트로 모드를 바꿀 수 없다(설정이 끔이면 아무것도 하지 않는다).
import os from "node:os";
import postgres from "postgres";
import { fetchBoardChildren, fetchCenterId, loginClassnote } from "./classnote-admin-core.mjs";
import { launchBrowser } from "./classnote-core.mjs";
import { loadReplyFacts, loadReplyMode, processParentRepliesOnce } from "./classnote-parent-reply-core.mjs";
import { getPost, listComments } from "./parent-reply-api.mjs";
import { evaluateReplyTarget, findExistingReplyComment, isReplyPostExpired, preflightReplyRow, replyErrorLabel } from "./parent-reply-guard.mjs";

const MODE_LABEL = { off: "끔", test: "시험", on: "전체" };

const args = process.argv.slice(2);
const id = args[args.indexOf("--id") + 1];
const POST = args.includes("--post");
const CHECK = args.includes("--check");
if (!args.includes("--id") || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
  console.error("사용법: --id <답글 id(uuid)> [--check | --post]");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
let browser = null;
try {
  const [row] = await sql`select * from classnote_parent_replies where id = ${id}`;
  if (!row) throw new Error("그 답글 행이 없습니다");
  const action = row.status === "edit_requested" ? "edit" : row.status === "delete_requested" ? "delete" : "post";
  console.log(`[점검] 상태 ${row.status} · 할 일 ${action} · 글 ${row.classnote_post_id} · 보드 ${row.board_id ?? "?"} · 원아 ${row.child_id ?? "?"}`);
  console.log(`[점검] 게시 명의 "${row.author_label}" · 본문 ${String(row.body).length}자${row.pending_body ? ` · 수정 본문 ${row.pending_body.length}자` : ""}`);
  const mode = await loadReplyMode(sql, row.tenant_id);
  const pre = preflightReplyRow({ mode, row: { ...row, processing_action: action } });
  console.log(`[점검] 모드 ${MODE_LABEL[mode]}(학원 설정) · 사전 판정 ${pre.ok ? "통과" : `거절 — ${replyErrorLabel(pre.code)}`}`);
  if (action === "post" && isReplyPostExpired(row)) console.log(`[점검] ⚠ ${replyErrorLabel("expired")} (이미 올라가 있는 댓글이 있으면 그 댓글로 성공 처리)`);
  if (!pre.ok || (!CHECK && !POST)) process.exit(0);
  if (!["queued", "edit_requested", "delete_requested"].includes(row.status) && POST) throw new Error(`처리할 상태가 아닙니다(${row.status})`);

  browser = await launchBrowser();
  if (CHECK && !POST) {
    const page = await browser.newPage();
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    const post = await getPost(page, row.classnote_post_id);
    const kids = post?.status === 200 && post.cls ? await fetchBoardChildren(page, centerId, post.cls).catch(() => null) : null;
    const facts = post?.status === 200 && post.cls ? await loadReplyFacts(sql, row.tenant_id, row, Number(post.cls)).catch(() => null) : null;
    const t = evaluateReplyTarget({ mode, row, post, boardChildren: kids, facts });
    console.log(`[확인] 원글 HTTP ${post?.status} · 보드 ${post?.cls ?? "?"} · 원아 ${post?.child ?? "?"} · 보드 원아 ${Array.isArray(kids) ? kids.length : "조회 실패"}명`);
    console.log(`[확인] 대상 판정 ${t.ok ? "통과" : `거절 — ${replyErrorLabel(t.code)}`}`);
    const listed = await listComments(page, row.classnote_post_id);
    const dup = listed.ok ? findExistingReplyComment(listed.list, { body: row.body, authorName: row.author_label }) : null;
    console.log(`[확인] 댓글 ${listed.ok ? `${listed.list.length}개` : `조회 실패(${listed.detail})`} · 같은 본문 봇 댓글 ${dup ?? "없음"}`);
    await page.close();
  } else if (POST) {
    const res = await processParentRepliesOnce(sql, browser, {
      tenant: row.tenant_id, post: true, host: `${os.hostname()}(1회 실행)`, onlyId: row.id,
    });
    console.log("[처리]", JSON.stringify(res));
    const [after] = await sql`select status, classnote_comment_id, error, error_raw, retry_count from classnote_parent_replies where id = ${id}`;
    console.log("[처리 뒤]", JSON.stringify(after));
  }
} catch (e) {
  console.error("[오류]", e?.message ?? e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await sql.end({ timeout: 2 }).catch(() => {});
}
