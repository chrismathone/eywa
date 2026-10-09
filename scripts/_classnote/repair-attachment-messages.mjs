// 과거 알림은 남았는데 첨부 전용 원문이 없는 경우를 GET으로 재수집한다.
// 신원·보드명을 추측하지 않는다. 실제 ClassNote 원문으로만 storeParentMessages를 채운다.
import { isParentPost } from "./parent-post-filter.mjs";
import { attachOnlyText, imageAttachments } from "./parent-comment-filter.mjs";
import { loadChildStudentMap, storeParentMessages } from "./classnote-inbox-store.mjs";

export function attachmentRecoveryItems(post, comments, expectedId) {
  if (Number(post?.id) !== expectedId || !Number.isSafeInteger(expectedId) || expectedId <= 0) return [];
  const childId = Number(post.child);
  if (!Number.isSafeInteger(childId) || childId <= 0 || typeof post.class_name !== "string" || !post.class_name.trim()) return [];
  const base = { postId: expectedId, childId, className: post.class_name };
  const items = [];
  if (isParentPost(post) && attachOnlyText(post)) items.push({ ...base, source: "post", content: post.content, attachOnly: attachOnlyText(post), attachments: imageAttachments(post), postedAt: post.created ?? null });
  for (const comment of comments ?? []) {
    const commentId = Number(comment?.id);
    if (comment?.author?.type !== "parent" || !attachOnlyText(comment) || !Number.isSafeInteger(commentId) || commentId <= 0) continue;
    items.push({ ...base, source: "comment", commentId, content: comment.content, attachOnly: attachOnlyText(comment), attachments: imageAttachments(comment), postedAt: comment.created ?? null });
  }
  return items;
}

const tried = new Map();
let repairing = false;
let repairWork = null;
export async function waitForAttachmentIdle() { if (repairWork) await repairWork; }
/** 발송 루프를 기다리게 하지 않는다. 이미 복구 중이면 다음 폴은 건너뛴다. */
export function kickAttachmentRepair(sql, tenant, session, log = console.log) {
  if (repairing) return;
  repairing = true;
  repairWork = repairAttachmentMessages(sql, tenant, session, log)
    .catch(() => log("[첨부 복구] 원문 목록 재조회 보류 — 다음 폴에서 재시도합니다"))
    .finally(() => { repairing = false; });
}
/** 한 폴에 글 하나, 실패한 대상은 10분 뒤 재시도. 실제 게시·알림 생성·AI 분류는 호출하지 않는다. */
export async function repairAttachmentMessages(sql, tenant, session, log = console.log) {
  const now = Date.now();
  for (const [key, until] of tried) if (until <= now) tried.delete(key);
  const rows = await sql`
    select distinct substring(n.link from '/service/report/([0-9]+)')::bigint as post_id
    from notifications n
    where n.tenant_id = ${tenant} and n.type in ('classnote_parent_post', 'classnote_parent_comment')
      and n.created_at > now() - interval '14 days' and n.body like '%(내용 없이 첨부만)%'
      and n.link ~ '/service/report/[0-9]+'
      and not exists (
        select 1 from classnote_parent_messages m where m.tenant_id = n.tenant_id
          and m.classnote_post_id::text = substring(n.link from '/service/report/([0-9]+)')
          and ((n.type = 'classnote_parent_post' and m.source = 'post')
            or (n.type = 'classnote_parent_comment' and m.source = 'comment' and m.content = n.body
              and (n.link !~ '[?&]comment=[0-9]+' or m.classnote_comment_id::text = substring(n.link from '[?&]comment=([0-9]+)'))))
      )
    order by post_id desc limit 50`;
  const row = rows.find((r) => !tried.has(`${tenant}:${r.post_id}`));
  if (!row) return 0;
  const postId = Number(row.post_id);
  tried.set(`${tenant}:${postId}`, now + 10 * 60_000);
  try {
    const { page, centerId } = await session();
    const { post, comments } = await page.evaluate(async ([id, center]) => {
      const get = async (url) => {
        const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`첨부 원문 조회 HTTP ${response.status}`);
        return response.json();
      };
      const post = await get(`/api/v1/reports/${id}/`);
      if (post.center != null && String(post.center) !== String(center)) throw new Error("첨부 원문의 기관이 다릅니다");
      const comments = [];
      if (Number(post.num_comments) > 0) {
        let next = `/api/v1/reports/${id}/comments/?page_size=100`;
        for (let i = 0; next && i < 5; i++) {
          const url = new URL(next, location.origin);
          if (url.origin !== location.origin || url.pathname !== `/api/v1/reports/${id}/comments/`) throw new Error("댓글 조회 경로가 다릅니다");
          const body = await get(url.href);
          comments.push(...(body.results ?? []));
          next = body.next;
        }
      }
      return { post, comments };
    }, [postId, centerId]);
    const items = attachmentRecoveryItems(post, comments, postId);
    if (!items.length) return 0;
    const inserted = await storeParentMessages(sql, tenant, items, await loadChildStudentMap(sql, tenant));
    if (inserted) log(`[첨부 복구] 원문 ${inserted}건 저장 — 답글·공감 가능, 알림 재발송 없음`);
    return inserted;
  } catch (error) {
    log(`[첨부 복구] 원문 재조회 보류 — ${String(error?.message ?? error).slice(0, 120)}`);
    return 0;
  }
}
