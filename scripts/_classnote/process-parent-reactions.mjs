// scripts/_classnote/process-parent-reactions.mjs — 학부모 글 공감(0319a) **한 건** 처리(개발 PC 시험·연동 PC 수동 복구용).
//
//   node --env-file=.env.local scripts/_classnote/process-parent-reactions.mjs --id <공감 행 id>          # 점검(쓰기 0, ClassNote 접속 0)
//   node --env-file=.env.local scripts/_classnote/process-parent-reactions.mjs --id <공감 행 id> --post   # 그 한 건만 실제 처리
//
// 🔴 하트비트(classnote_workers)를 쓰지 않는다 — 실게시 임대는 데몬만의 것이다(process-parent-replies.mjs와 같은 규약).
// 🔴 지점은 그 행의 tenant_id로 정한다. 모드는 그 지점의 학원 설정(끔·시험·전체)을 DB에서 읽는다 — 이 스크립트로 바꿀 수 없다.
import os from "node:os";
import postgres from "postgres";
import { launchBrowser } from "./classnote-core.mjs";
import { processParentReactionsOnce } from "./classnote-parent-reaction-core.mjs";
import { loadReplyMode } from "./classnote-parent-reply-core.mjs";
import { REACTION_LABELS, isReactionExpired, preflightReactionRow, reactionErrorLabel } from "./parent-reaction-guard.mjs";

const args = process.argv.slice(2);
const id = args[args.indexOf("--id") + 1];
const POST = args.includes("--post");
if (!args.includes("--id") || !/^[0-9a-f-]{36}$/i.test(id ?? "")) {
  console.error("사용법: --id <공감 행 id(uuid)> [--post]");
  process.exit(1);
}
const MODE_LABEL = { off: "끔", test: "시험", on: "전체" };

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
let browser = null;
try {
  const [row] = await sql`select * from classnote_parent_reactions where id = ${id}`;
  if (!row) throw new Error("그 공감 행이 없습니다");
  const action = row.status === "remove_requested" ? "remove" : "add";
  const kind = REACTION_LABELS[row.reaction_type] ?? "알 수 없는 종류";
  console.log(`[점검] 상태 ${row.status} · 할 일 ${action === "add" ? "누르기" : "풀기"} · 글 ${row.classnote_post_id}${row.target_comment_id ? ` · 댓글 ${row.target_comment_id}` : ""} · 보드 ${row.board_id ?? "?"} · 원아 ${row.child_id ?? "?"}`);
  console.log(`[점검] 공감 "${kind}" · 명의 "${row.author_label}"`);
  const mode = await loadReplyMode(sql, row.tenant_id);
  const pre = preflightReactionRow({ mode, row: { ...row, processing_action: action } });
  console.log(`[점검] 모드 ${MODE_LABEL[mode]}(학원 설정) · 사전 판정 ${pre.ok ? "통과" : `거절 — ${reactionErrorLabel(pre.code)}`}`);
  if (action === "add" && isReactionExpired(row)) console.log(`[점검] ⚠ ${reactionErrorLabel("expired")} (이미 눌려 있으면 그 공감으로 성공 처리)`);
  if (!pre.ok || !POST) process.exit(0);
  if (!["queued", "remove_requested"].includes(row.status)) throw new Error(`처리할 상태가 아닙니다(${row.status})`);

  browser = await launchBrowser();
  const res = await processParentReactionsOnce(sql, browser, { tenant: row.tenant_id, post: true, host: `${os.hostname()}(1회 실행)`, onlyId: row.id });
  console.log("[처리]", JSON.stringify(res));
  const [after] = await sql`select status, classnote_reaction_id, error, error_raw, retry_count from classnote_parent_reactions where id = ${id}`;
  console.log("[처리 뒤]", JSON.stringify(after));
} catch (e) {
  console.error("[오류]", e?.message ?? e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  await sql.end({ timeout: 2 }).catch(() => {});
}
