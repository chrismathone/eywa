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
 * 이 페이지가 **age 가드보다 오래된 구간에 진입했나** — 그렇다면 더 과거로 갈 이유가 없다
 * (피드는 id desc이고, 그 아래는 어차피 전부 `tooOld`로 버려질 글이다).
 *
 * ⚠️ 페이지 수로 따라잡기 범위를 정하면 안 된다(2026-07-15 실측): "피드 ~140건/일"이라는 추정이 틀렸고
 * (바쁜 날 **249~270건/일**) 500행 상한이 age 가드(3일) 안의 글을 조용히 건너뛰었다. 밀도는 계절·시기에 따라
 * 계속 변하므로 **행 수가 아니라 시간으로** 멈춘다. `created`는 순서엔 못 쓰지만(주입값 존재) age 판정엔 쓴다 —
 * 여기선 "그만 파도 되나"의 힌트일 뿐이고, 진짜 선별은 `selectNewParentPosts`가 행 단위로 다시 한다.
 *
 * @param {FeedRow[] | null | undefined} rows
 * @param {{ nowMs?: number, maxAgeDays?: number }} [opts]
 * @returns {boolean} 페이지에 **유효한 created가 하나라도 있고**, 그 중 가장 최근 것조차 age 컷오프보다 오래됨
 */
export function pageOlderThanAgeGuard(rows, { nowMs = Date.now(), maxAgeDays = 3 } = {}) {
  const cutoff = nowMs - maxAgeDays * 24 * 60 * 60 * 1000;
  let sawValid = false;
  let newest = -Infinity;
  for (const r of rows ?? []) {
    const t = Date.parse(r?.created ?? "");
    if (!Number.isFinite(t)) continue; // created가 깨진 행은 판단 근거로 쓰지 않는다
    sawValid = true;
    if (t > newest) newest = t;
  }
  return sawValid && newest < cutoff;
}

/**
 * 유효이름(`classnote_name ?? name`)별 **인원수** — 동명이인(신원 불명) 판정용.
 *
 * ⚠️ 이 함수에 넘기는 rows는 **status·과목 무필터 전 학생**이어야 한다(퇴원·예비 포함). 재원생만 넘기면
 * F1 구멍이 열린다: ClassNote 보드는 학생 수명주기보다 오래 살아서 **퇴원한 동명 학생의 보드에 그 가족이
 * 그대로 붙어 있고**, 그 보드를 재원 동명 학생으로 확정하면 **퇴원 가족의 사적인 글이 엉뚱한 강사에게** 간다
 * (2026-07-15 적대리뷰가 프로덕션에서 실증: `(수학)김채은` 보드의 원아는 퇴원 김채은(중1), 재원 김채은은 고1).
 *
 * ⚠️ 이름 목록을 `Set`으로 접으면 **완전히 같은 이름 2명이 1개가 되어 안 잡힌다** — 반드시 센다.
 * (provision의 `fetchUniverseNames`가 Set인 이유는 "다른 이름끼리의 충돌"을 보기 때문 — 용도가 다르다.)
 *
 * @param {Array<{ name?: string|null, classnote_name?: string|null }> | null | undefined} rows
 * @param {(s: string) => string} normFn - 이름 정규화(공백 제거 등). 순수성 유지를 위해 주입받는다.
 * @returns {Map<string, number>} 정규화 이름 → 인원수
 */
export function countByEffectiveName(rows, normFn) {
  const counts = new Map();
  for (const r of rows ?? []) {
    const eff = String(r?.classnote_name || r?.name || "").trim();
    if (!eff) continue;
    const key = normFn(eff);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 알림 문구 — 강사가 벨에서 **본문을 바로 읽고 판단**할 수 있어야 한다(ClassNote 앱을 안 열어도 되는 게 이 기능의 요점).
 * 벨은 body를 자르지 않고 그대로 렌더하므로 200자까지 싣는다. 첨부만 있는 글도 "왜 알림이 왔는지" 알려준다.
 * @param {FeedRow} post
 * @param {string} studentName
 * @returns {{ title: string, body: string }}
 */
/**
 * 알림 클릭 시 열 **ClassNote 글 주소** — 강사가 그 자리에서 답글을 달 수 있도록(원장 요청 2026-07-15).
 *
 * 형식 확정(실측): `/service/report/{id}`가 그 글의 상세 화면을 렌더한다(`/service/report/detail/{id}`는 404).
 * ⚠️ SPA라 **어떤 경로든 HTTP 200**을 준다 — 형식을 바꿀 땐 상태코드가 아니라 **렌더된 내용**으로 확인할 것
 * (2026-07-15: 1.2초만 기다려 "내용 없음"으로 오판했다가 3.5초 기다리니 정상이었다).
 * ⚠️ ClassNote 교사 계정이 없는 강사(예: 박민엽 — 24명 명단에 없음)는 로그인 화면을 보게 된다.
 * 그래서 **본문(body)에 글 전문을 계속 싣는다** — 링크는 보조, 정보 전달은 본문이 책임진다.
 *
 * @param {number} postId
 * @param {string} [base] - 도메인(테스트 주입용). 기본 = classnote.com.
 * @param {number | string | null} [commentId] - 댓글 알림이면 그 댓글 번호(`?comment=`) — 앱 벨이 번호로 정확히 짝짓는다.
 */
export function classnotePostUrl(postId, base = "https://www.classnote.com", commentId = null) {
  // 댓글 알림은 `?comment=<댓글 번호>`를 싣는다 — 앱 벨이 알림 ↔ 저장된 댓글을 번호로 정확히 짝짓는다(본문이 "(내용 없이 첨부만)"인
  // 댓글은 글자 비교가 불가능하다). ClassNote SPA는 모르는 쿼리를 무시한다(그 글 상세가 그대로 열린다).
  const c = Number(commentId);
  return `${base}/service/report/${postId}${Number.isFinite(c) && c > 0 ? `?comment=${c}` : ""}`;
}

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
