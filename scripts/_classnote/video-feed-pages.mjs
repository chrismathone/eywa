/** API가 URL 또는 cursor를 돌려줘도 같은 기관/게시물의 다음 페이지만 읽는다. */
export function nextVideoCursor(next, endpoint) {
  if (!next) return null;
  if (!/^https?:|^\//i.test(next)) return String(next);
  const url = new URL(next, "https://www.classnote.com");
  if (url.pathname !== endpoint) throw new Error("다음 페이지 경로가 원본과 다릅니다.");
  const cursor = url.searchParams.get("page");
  if (!cursor) throw new Error("다음 페이지 번호가 없습니다.");
  return cursor;
}

export async function videoFeedPage(page, endpoint, cursor = null, centerId = null) {
  const body = await page.evaluate(async ({ endpoint, cursor, centerId }) => {
    const qs = new URLSearchParams({ page_size: "100", tz: "Asia/Seoul" });
    if (cursor) qs.set("page", cursor);
    if (centerId) qs.set("center_id", String(centerId));
    const response = await fetch(`${endpoint}?${qs}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`영상 기록 조회 HTTP ${response.status}`);
    return response.json();
  }, { endpoint, cursor, centerId });
  if (!Array.isArray(body.results)) throw new Error("영상 기록 응답 형식이 다릅니다.");
  const next = nextVideoCursor(body.next, endpoint);
  if (next && (next === cursor || !body.results.length)) throw new Error("영상 기록 페이지가 진행되지 않습니다.");
  return { list: body.results, next };
}

export async function allVideoComments(page, postId) {
  if (!/^[1-9]\d*$/.test(String(postId))) throw new Error("게시물 번호가 올바르지 않습니다.");
  const items = [];
  const seen = new Set();
  let cursor = null;
  do {
    const result = await videoFeedPage(page, `/api/v1/reports/${postId}/comments/`, cursor);
    items.push(...result.list);
    cursor = result.next;
    if (cursor && seen.has(cursor)) throw new Error("댓글 페이지가 반복됩니다.");
    seen.add(cursor);
  } while (cursor);
  return items;
}
