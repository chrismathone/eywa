/**
 * scripts/_classnote/parent-post-filter.mjs — 학부모 글 감지의 **순수 로직**(IO 없음 · Vitest 대상).
 *
 * IO(로그인·피드조회·DB)는 classnote-feed-core.mjs가 담당하고, "무엇을 새 글로 볼 것인가"의 판단만 여기 모은다
 * (legacy-audio-path.ts와 같은 순수/IO 분리 — 워커 파일은 playwright/postgres를 물고 있어 단위테스트가 불가).
 *
 * ClassNote 피드 계약(2026-07-15 실측):
 *  - `GET /api/v1_2/centers/{c}/reports/` = 기관 전체 피드(원아 필터 없이 200) — 한 폴에 요청 1개.
 *  - **정렬 = id 내림차순**. DRF CursorPagination의 커서가 base64("p=<직전 페이지 마지막 id>")라
 *    id가 곧 페이지네이션 위치 키 = 정렬은 우연이 아니라 **API 계약**. → 워터마크(마지막 본 id)가 안전.
 *  - `author.type` ∈ {admin, teacher, parent}. 학부모 글 = **parent**(3주 표본 3,000건 중 89건).
 *  - `created`는 신뢰 금지(마이크로초 .000000인 주입값 존재) — **순서 판단은 반드시 id**, created는 age 가드에만.
 */

/**
 * ClassNote 피드 행(필요한 필드만).
 * @typedef {{ id: number, created?: string, author?: { type?: string }, class_name?: string,
 *             content?: string, attached_images?: unknown[], attached_files?: unknown[], attached_video?: unknown }} FeedRow
 */

/**
 * 학부모가 쓴 글인가 — 강사(teacher)·기관(admin) 글은 제외.
 * @param {Partial<FeedRow> | null | undefined} row - 피드가 필드를 빠뜨려도 안전하게 false.
 */
export function isParentPost(row) {
  return row?.author?.type === "parent";
}

/**
 * 피드에서 본 가장 큰 id = 다음 워터마크. 비었으면 null.
 * @param {FeedRow[] | null | undefined} rows
 * @returns {number | null}
 */
export function maxPostId(rows) {
  let max = null;
  for (const r of rows ?? []) {
    const id = Number(r?.id);
    if (Number.isFinite(id) && (max === null || id > max)) max = id;
  }
  return max;
}

/**
 * 이 피드 페이지가 워터마크에 도달했나(= 더 과거로 안 가도 되나).
 * @param {FeedRow[] | null | undefined} rows
 * @param {number | null | undefined} lastSeenId
 */
export function reachedWatermark(rows, lastSeenId) {
  if (lastSeenId === null || lastSeenId === undefined) return true;
  return (rows ?? []).some((r) => Number(r?.id) <= Number(lastSeenId));
}

/**
 * 알림 대상 = 학부모 글 ∧ 워터마크 초과 ∧ 대상 보드 prefix ∧ 너무 오래되지 않음.
 *
 * ⚠️ **age 가드(maxAgeDays)는 안전장치다** — 연동 PC가 오래 꺼져 있다가 켜지면 밀린 글이 한꺼번에 알림으로
 * 쏟아진다(edutrix 3,500건 오발송 사고의 내부 알림판). 오래된 "오늘 늦어요"는 이미 무의미하므로 버린다.
 * 워터마크는 그래도 전진하므로 같은 글이 다음 폴에 다시 잡히지 않는다.
 *
 * @param {FeedRow[] | null | undefined} rows
 * @param {{ lastSeenId?: number | null, prefix?: string, nowMs?: number, maxAgeDays?: number }} [opts]
 * @returns {{ picked: FeedRow[], tooOld: FeedRow[] }} picked = 오래된 것 → 최신 순(id 오름차순, 알림이 시간순으로 쌓이도록)
 */
export function selectNewParentPosts(rows, { lastSeenId = null, prefix, nowMs = Date.now(), maxAgeDays = 3 } = {}) {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const picked = [];
  const tooOld = [];
  for (const r of rows ?? []) {
    const id = Number(r?.id);
    if (!Number.isFinite(id)) continue;
    if (lastSeenId !== null && id <= Number(lastSeenId)) continue;
    if (!isParentPost(r)) continue;
    if (prefix && !String(r?.class_name ?? "").startsWith(prefix)) continue;
    const t = Date.parse(r?.created ?? "");
    if (Number.isFinite(t) && nowMs - t > maxAgeMs) {
      tooOld.push(r);
      continue;
    }
    picked.push(r);
  }
  picked.sort((a, b) => Number(a.id) - Number(b.id));
  return { picked, tooOld };
}

/**
 * 알림 문구 — 강사가 벨에서 **본문을 바로 읽고 판단**할 수 있어야 한다(ClassNote 앱을 안 열어도 되는 게 이 기능의 요점).
 * 벨은 body를 자르지 않고 그대로 렌더하므로 200자까지 싣는다. 첨부만 있는 글도 "왜 알림이 왔는지" 알려준다.
 * @param {FeedRow} post
 * @param {string} studentName
 * @returns {{ title: string, body: string }}
 */
export function buildNotificationText(post, studentName) {
  const text = String(post?.content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const bits = [];
  const imgs = (post?.attached_images ?? []).length;
  const files = (post?.attached_files ?? []).length;
  if (imgs) bits.push(`사진 ${imgs}장`);
  if (files) bits.push(`파일 ${files}개`);
  if (post?.attached_video) bits.push("영상");
  const attach = bits.length ? `[${bits.join("·")}] ` : "";
  const body = text
    ? `${attach}${text.length > 200 ? text.slice(0, 200) + "…" : text}`
    : bits.length
      ? `${attach}(내용 없이 첨부만)`
      : "학부모님이 새 글을 남겼습니다";
  return { title: `${studentName} 학부모 글`, body };
}
