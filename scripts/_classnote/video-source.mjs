import { fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";
import { videoCandidate } from "./video-download.mjs";

/** 첫 시험은 최근 글 최대 500개에서 영상 1건만 고른다. 글 없이 영상만 있는 게시물도 포함. */
export async function findRecentVideo({ anyAuthor = false, maxPages = 5 } = {}) {
  const browser = await launchAdminBrowser();
  try {
    const page = await browser.newPage();
    await loginClassnote(page);
    const centerId = await fetchCenterId(page);
    let cursor = null;
    let scanned = 0;
    for (let index = 0; index < maxPages; index++) {
      const body = await page.evaluate(async ({ centerId, cursor }) => {
        const qs = new URLSearchParams({ page_size: "100", tz: "Asia/Seoul", center_id: String(centerId) });
        if (cursor) qs.set("page", cursor);
        const response = await fetch(`/api/v1_2/centers/${centerId}/reports/?${qs}`, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`영상 목록 조회 HTTP ${response.status}`);
        return response.json();
      }, { centerId, cursor });
      const posts = body.results ?? [];
      scanned += posts.length;
      for (const post of posts) {
        const candidate = videoCandidate(post, centerId, anyAuthor);
        if (candidate) return { candidate, scanned };
      }
      if (!body.next || !posts.length) break;
      cursor = body.next;
    }
    throw new Error(`최근 글 ${scanned}개에서 내려받을 ${anyAuthor ? "" : "학부모 "}영상을 찾지 못했습니다.`);
  } finally { await browser.close(); }
}
