/**
 * scripts/_classnote/backfill-attach-only-messages.mjs — 글자 없이 **첨부만 있는** 학부모 글·댓글(영상·사진 숙제)과 사진 주소를 원문 표에 채운다(1회성 백필).
 *
 * 왜 필요한가: 워커는 새 글·댓글만 읽는다(워터마크·댓글 수 스냅샷 — 이미 읽은 건 다시 안 본다). 그래서 "첨부만" 글이 원문 표에 저장되기 시작한
 * 2026-10-01 **이전**에 온 글은 영영 저장되지 않아 벨에 '답글 쓰기'가 안 뜬다. 이 스크립트가 최근 N일치(기본 3일 = 워커가 알림을 만드는 창)를
 * ClassNote 피드에서 다시 읽어(GET만) 같은 저장 함수(`storeParentMessages`)로 채운다 — 멱등(이미 있는 행은 그대로).
 *
 * 실행(연동 PC 또는 CLASSNOTE_UPLOAD_ID/PW·DATABASE_URL이 있는 PC — 지점이 둘 이상이면 CLASSNOTE_TENANT_ID도):
 *   node --env-file=.env.local scripts/_classnote/backfill-attach-only-messages.mjs            # 드라이런(기본) — DB 쓰기 없음, 건수만 보고
 *   node --env-file=.env.local scripts/_classnote/backfill-attach-only-messages.mjs --days=5    # 창 조정(1~14일)
 *   node --env-file=.env.local scripts/_classnote/backfill-attach-only-messages.mjs --apply     # 실제 저장 — 원장 승인 뒤에만
 *
 * 안전:
 *  - ClassNote에는 **쓰기 요청이 없다**(피드 목록·글별 댓글 목록 GET뿐). 학부모에게 나가는 것 없음.
 *  - 저장하는 것은 ① 첨부만 있는 글·댓글의 대체 원문 행(분류는 끝난 것으로 — AI·출결 알림에 안 걸린다) ② 사진 주소(0326a 표, 이미 있으면 그대로).
 *    **글자가 있는 글은 새 행을 만들지 않는다**(출결 분류 큐에 옛 글이 들어가는 것을 막는다) — 이미 저장된 글에 사진 주소만 붙인다.
 *  - 개인정보는 출력하지 않는다(건수만).
 *  - 데몬이 도는 중에 --apply를 같이 돌려도 안전하다(저장은 on conflict do nothing).
 */
import postgres from "postgres";
import { launchBrowser, resolveTenant } from "./classnote-core.mjs";
import { fetchComments, fetchReadWindow, videoFeedSession } from "./classnote-feed-core.mjs";
import { loadChildStudentMap, storeAttachments, storeParentMessages } from "./classnote-inbox-store.mjs";
import { attachOnlyText, imageAttachments } from "./parent-comment-filter.mjs";
import { isParentPost } from "./parent-post-filter.mjs";

const APPLY = process.argv.includes("--apply");
const daysArg = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7));
const DAYS = Number.isFinite(daysArg) ? Math.min(14, Math.max(1, Math.floor(daysArg))) : 3;
const DAY_MS = 86_400_000;

// 글 = 워커와 같은 판정(`isParentPost`) · 댓글 = `selectNewComments`와 같은 판정(작성자 종류 parent).
const isParentComment = (x) => x?.author?.type === "parent";
const inWindow = (x, now) => {
  const t = Date.parse(x?.created ?? "");
  return !Number.isFinite(t) || now - t <= DAYS * DAY_MS;
};
const key = (source, postId, commentId) => `${source}:${postId}:${commentId ?? 0}`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  if (!process.env.CLASSNOTE_UPLOAD_ID || !process.env.CLASSNOTE_UPLOAD_PW) throw new Error("CLASSNOTE_UPLOAD_ID / CLASSNOTE_UPLOAD_PW env가 필요합니다");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  const browser = await launchBrowser();
  try {
    const tenant = await resolveTenant(sql);
    const now = Date.now();
    console.log(`tenant=${tenant} · 창=${DAYS}일 · mode=${APPLY ? "APPLY(저장)" : "드라이런(DB 쓰기 없음)"}`);

    const rows = (await fetchReadWindow(browser, { maxAgeDays: DAYS, label: "백필" }, console.log)).filter((r) => inWindow(r, now));
    const { page } = await videoFeedSession(browser);
    const items = []; // { source, postId, commentId?, childId, className, content, attachOnly, attachments, postedAt }
    for (const r of rows) {
      const base = { postId: r.id, childId: r.child ?? null, className: r.class_name ?? null };
      if (isParentPost(r)) {
        const attachOnly = attachOnlyText(r);
        const attachments = imageAttachments(r);
        if (attachOnly || attachments.length) items.push({ ...base, source: "post", content: r.content, attachOnly, attachments, postedAt: r.created ?? null });
      }
      // 댓글 — 댓글이 있는 글만 열어 본다(요청 수 = 창 안 댓글 달린 글 수. 글당 300ms 간격).
      if (Number(r.num_comments ?? 0) > 0) {
        let list = [];
        try { list = await fetchComments(page, r.id); } catch (e) { console.log(`댓글 조회 실패 1건(건너뜀): ${String(e.message).slice(0, 60)}`); }
        for (const k of list) {
          if (!isParentComment(k) || !inWindow(k, now)) continue;
          const attachOnly = attachOnlyText(k);
          const attachments = imageAttachments(k);
          if (attachOnly || attachments.length) items.push({ ...base, source: "comment", commentId: k.id, content: k.content, attachOnly, attachments, postedAt: k.created ?? null });
        }
        await new Promise((res) => setTimeout(res, 300));
      }
    }

    // 이미 저장된 행 — 같은 키(출처·글·댓글)로 조회한다.
    const postIds = [...new Set(items.map((i) => Number(i.postId)))];
    const stored = postIds.length
      ? await sql`select id, source, classnote_post_id, classnote_comment_id from classnote_parent_messages where tenant_id = ${tenant} and classnote_post_id in ${sql(postIds)}`
      : [];
    const have = new Map(stored.map((s) => [key(s.source, Number(s.classnote_post_id), s.classnote_comment_id == null ? 0 : Number(s.classnote_comment_id)), s.id]));
    let hasPhotos = new Set();
    try {
      const ids = [...have.values()];
      if (ids.length) hasPhotos = new Set((await sql`select message_id from classnote_parent_message_attachments where message_id in ${sql(ids)}`).map((r) => r.message_id));
    } catch (e) {
      console.log(`사진 주소 표 없음(0326a 전) — 사진은 건너뜁니다: ${e.code ?? e.message}`);
      hasPhotos = null;
    }

    const attachItems = items.filter((i) => i.attachOnly);
    const toInsert = attachItems.filter((i) => !have.has(key(i.source, Number(i.postId), i.commentId == null ? 0 : Number(i.commentId))));
    const photoItems = items.filter((i) => i.attachments.length);
    // 붙일 수 있는 것 = 행이 이미 있는데 주소가 없거나, 이번에 첨부만 행을 새로 넣는 것. 글자 있는 글인데 행이 없으면 붙을 데가 없다(세지 않는다).
    const photoMissing = hasPhotos === null ? [] : photoItems.filter((i) => {
      const id = have.get(key(i.source, Number(i.postId), i.commentId == null ? 0 : Number(i.commentId)));
      return id ? !hasPhotos.has(id) : !!i.attachOnly;
    });
    const by = (list, source) => list.filter((i) => i.source === source).length;
    const kind = (list, re) => list.filter((i) => re.test(i.attachOnly ?? "")).length;
    console.log([
      `창 안 학부모 첨부 글·댓글: 글 ${by(items, "post")} · 댓글 ${by(items, "comment")}`,
      `  첨부만(글자 없음) ${attachItems.length}건 중 이미 저장 ${attachItems.length - toInsert.length}건 · 새로 저장할 것 ${toInsert.length}건 (글 ${by(toInsert, "post")} · 댓글 ${by(toInsert, "comment")})`,
      `    새로 저장할 것의 종류: 영상 포함 ${kind(toInsert, /^\[[^\]]*영상/)} · 사진(영상 없음) ${kind(toInsert, /^\[(?![^\]]*영상)[^\]]*사진/)} · 그 밖(스티커·파일) ${toInsert.length - kind(toInsert, /^\[[^\]]*(영상|사진)/)}`,
      hasPhotos === null
        ? `  사진 있는 글·댓글 ${photoItems.length}건 — 사진 주소 표(0326a)가 없어 붙이지 않습니다(SQL 적용 뒤 다시 돌리면 붙는다)`
        : `  사진 주소를 붙일 것 ${photoMissing.length}건 (사진 있는 글·댓글 ${photoItems.length}건 중)`,
    ].join("\n"));
    if (!APPLY) {
      console.log("\n드라이런 — DB에 아무것도 쓰지 않았습니다. 저장하려면 --apply (원장 승인 뒤).");
      return;
    }
    const childToStudent = await loadChildStudentMap(sql, tenant);
    // 새 행은 첨부만 있는 것만(분류 큐에 옛 글이 들어가지 않게) — 사진 주소는 그 뒤에 붙인다(행이 생긴 다음이어야 붙는다).
    const inserted = await storeParentMessages(sql, tenant, toInsert, childToStudent);
    await storeAttachments(sql, tenant, photoMissing);
    console.log(`\n저장 완료 — 새 행 ${inserted}건 · 사진 주소 대상 ${photoMissing.length}건`);
  } finally {
    await browser.close().catch(() => {});
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
