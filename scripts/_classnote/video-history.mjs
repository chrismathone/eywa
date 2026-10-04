import { videoFeedPage, allVideoComments } from "./video-feed-pages.mjs";
import { enqueueParentVideos } from "./video-inbox.mjs";

/**
 * 한 바퀴를 다 돈 뒤 다시 처음부터 훑기까지의 간격(원장 2026-10-01 "7일로 바꿔").
 * 다시 도는 이유 = 오래된 글에 뒤늦게 달린 댓글 영상. 최근 글의 새 댓글은 댓글 폴러가 따로 거두므로 하루마다 돌 필요가 없고,
 * 전체를 실제로 한 바퀴 돌 수 있게 된 뒤로는 매일 도는 것이 ClassNote에 매일 몇 시간치 요청을 보낸다.
 */
export const RESCAN_AFTER_MS = 7 * 24 * 60 * 60_000;

/** 볼 것이 없는 글 — 학부모가 올린 영상도 댓글도 없다(영상 후보 = 학부모 글의 `attached_video`뿐 — video-download `videoCandidate`).
 *  교사·기관이 영상을 붙인 글도 댓글이 없으면 여기 든다(큐에 들어갈 수 없다). */
const nothingToRead = (post) => !(post.attached_video && post.author?.type === "parent") && !(Number(post.num_comments) > 0);

/**
 * 오래된 글의 새 댓글도 회수하도록 전 이력을 순환한다. DB 진행 기록은 PC 교체 시에도 이어진다.
 *
 * 🔑 글 목록 API에는 '학부모 글'·'영상 있는 글' 필터가 없다(2026-10-01 실측 — 웹 화면 필터도 반·학생·내가 쓴 글뿐이고,
 *    다른 파라미터는 조용히 무시된다). 대신 목록 한 쪽(100건)은 요청 1번이고, 영상도 댓글도 없는 글은 더 읽을 게 없다
 *    (실측: 최근 500건 전부가 그런 글). 그래서 그런 글은 예산 없이 넘기고, `limit`은 **손이 가는 글**(영상이 붙었거나 댓글이
 *    있는 글 = 큐 저장·댓글 조회)만 센다. 한 번 호출에 새로 읽는 목록 쪽 수는 `maxPages`까지.
 *    (글을 하나씩 세던 옛 방식은 분당 10건이라 하루 1만 4천 건 — 하루 저녁에만 수백 건이 쌓여 몇 주가 걸렸다.)
 */
export async function scanVideoHistory(sql, page, tenant, centerId, { limit = 10, maxPages = 3, log = console.log, archiveEnabled, env } = {}) {
  const videoOpts = {};
  if (typeof archiveEnabled === "boolean") videoOpts.enabled = archiveEnabled;
  if (env) videoOpts.env = env;
  await sql`insert into classnote_video_history (tenant_id,center_id) values (${tenant},${centerId}) on conflict do nothing`;
  let [row] = await sql`select state,revision from classnote_video_history where tenant_id=${tenant} and center_id=${centerId}`;
  let state = row.state;
  if (state.completedAt && Date.now() - new Date(state.completedAt).getTime() < RESCAN_AFTER_MS) return;
  if (state.completedAt) state = {};
  const persist = async () => {
    const updated = await sql`update classnote_video_history set state=${sql.json(state)}, revision=revision+1, updated_at=now()
      where tenant_id=${tenant} and center_id=${centerId} and revision=${row.revision} returning revision`;
    if (!updated.length) throw new Error("다른 워커가 과거 영상 수집을 진행했습니다.");
    row = updated[0];
  };
  let added = 0;
  let busy = 0; // 손이 간 글 수(예산 = limit)
  let pages = 0; // 이번 호출에서 새로 읽은 목록 쪽 수(예산 = maxPages)
  for (;;) {
    if (!state.pending) {
      if (pages >= maxPages) break;
      pages++;
      const result = await videoFeedPage(page, `/api/v1_2/centers/${centerId}/reports/`, state.cursor, centerId);
      const pending = result.list.map((post) => ({ id: post.id, author: { type: post.author?.type }, child: post.child,
        cls: post.cls, class_name: post.class_name, created: post.created, num_comments: post.num_comments,
        attached_video: post.attached_video ? { id: post.attached_video.id, high: post.attached_video.high, low: post.attached_video.low } : null }));
      state = { ...state, pending, next: result.next };
      await persist(); // 목록 자체를 고정한다. 새 글이 끼어들어도 재시작 시 꼬리를 빠뜨리지 않는다.
    }
    let skipped = false; // 넘긴 글이 아직 기록 전인가(다시 넘기는 데 요청·저장이 없어 미뤄도 된다)
    while (state.pending.length) {
      const post = state.pending[0];
      if (nothingToRead(post)) {
        state.pending.shift();
        state.scanned = (state.scanned ?? 0) + 1;
        skipped = true;
        continue;
      }
      if (busy >= limit) break;
      busy++;
      added += await enqueueParentVideos(sql, tenant, centerId, [post], null, videoOpts);
      if (Number(post.num_comments) > 0) {
        try {
          const comments = await allVideoComments(page, post.id);
          added += await enqueueParentVideos(sql, tenant, centerId, comments, post, videoOpts);
        } catch (error) {
          // ⚠️ `$`로 끝을 요구하지 말 것 — Playwright는 `page.evaluate: Error: …HTTP 404\n    at eval (…)`처럼 뒤에 스택을 붙인다.
          if (!/영상 기록 조회 HTTP (404|410)(?!\d)/.test(String(error?.message ?? ""))) throw error;
          log("[영상 이력] 삭제된 원글의 댓글은 읽을 수 없어 다음 글로 진행합니다.");
        }
      }
      state.pending.shift();
      state.scanned = (state.scanned ?? 0) + 1;
      await persist(); // 큐 저장 실패 시 이 글부터 다시. 이미 저장한 영상은 DB에서 합쳐진다. (앞에서 넘긴 글도 여기서 함께 기록된다)
      skipped = false;
    }
    if (state.pending.length) { // 예산을 다 썼다 — 남은 글은 다음 호출이 이어 간다
      if (skipped) await persist();
      break;
    }
    state = state.next ? { cursor: state.next, scanned: state.scanned } : { scanned: state.scanned, completedAt: new Date().toISOString() };
    await persist();
    if (state.completedAt) break;
  }
  log(`[영상 이력] 글 ${state.scanned ?? 0}건 확인 · 영상 ${added}건 추가${state.completedAt ? " · 전체 조회 완료" : " · 이어서 수집"}`);
  return { scanned: state.scanned ?? 0, added, complete: !!state.completedAt };
}
