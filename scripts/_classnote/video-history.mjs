import { videoFeedPage, allVideoComments } from "./video-feed-pages.mjs";
import { enqueueParentVideos } from "./video-inbox.mjs";

/** 오래된 글의 새 댓글도 회수하도록 전 이력을 순환한다. DB 진행 기록은 PC 교체 시에도 이어진다. */
export async function scanVideoHistory(sql, page, tenant, centerId, { limit = 10, log = console.log } = {}) {
  await sql`insert into classnote_video_history (tenant_id,center_id) values (${tenant},${centerId}) on conflict do nothing`;
  let [row] = await sql`select state,revision from classnote_video_history where tenant_id=${tenant} and center_id=${centerId}`;
  let state = row.state;
  if (state.completedAt && Date.now() - new Date(state.completedAt).getTime() < 24 * 60 * 60_000) return;
  if (state.completedAt) state = {};
  const persist = async () => {
    const updated = await sql`update classnote_video_history set state=${sql.json(state)}, revision=revision+1, updated_at=now()
      where tenant_id=${tenant} and center_id=${centerId} and revision=${row.revision} returning revision`;
    if (!updated.length) throw new Error("다른 워커가 과거 영상 수집을 진행했습니다.");
    row = updated[0];
  };
  if (!state.pending) {
    const result = await videoFeedPage(page, `/api/v1_2/centers/${centerId}/reports/`, state.cursor, centerId);
    const pending = result.list.map((post) => ({ id: post.id, author: { type: post.author?.type }, child: post.child,
      cls: post.cls, class_name: post.class_name, created: post.created, num_comments: post.num_comments,
      attached_video: post.attached_video ? { id: post.attached_video.id, high: post.attached_video.high, low: post.attached_video.low } : null }));
    state = { ...state, pending, next: result.next };
    await persist(); // 목록 자체를 고정한다. 새 글이 끼어들어도 재시작 시 꼬리를 빠뜨리지 않는다.
  }
  let added = 0;
  for (let n = 0; n < limit && state.pending.length; n++) {
    const post = state.pending[0];
    added += await enqueueParentVideos(sql, tenant, centerId, [post]);
    if (Number(post.num_comments) > 0) {
      try {
        const comments = await allVideoComments(page, post.id);
        added += await enqueueParentVideos(sql, tenant, centerId, comments, post);
      } catch (error) {
        if (!/영상 기록 조회 HTTP (404|410)$/.test(error.message)) throw error;
        log("[영상 이력] 삭제된 원글의 댓글은 읽을 수 없어 다음 글로 진행합니다.");
      }
    }
    state.pending.shift();
    state.scanned = (state.scanned ?? 0) + 1;
    await persist(); // 큐 저장 실패 시 이 글부터 다시. 이미 저장한 영상은 DB에서 합쳐진다.
  }
  if (!state.pending.length) {
    state = state.next ? { cursor: state.next, scanned: state.scanned } : { scanned: state.scanned, completedAt: new Date().toISOString() };
    await persist();
  }
  log(`[영상 이력] 글 ${state.scanned ?? 0}건 확인 · 영상 ${added}건 추가${state.completedAt ? " · 전체 조회 완료" : " · 이어서 수집"}`);
  return { scanned: state.scanned ?? 0, added, complete: !!state.completedAt };
}
