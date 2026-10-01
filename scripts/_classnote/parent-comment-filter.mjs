/**
 * scripts/_classnote/parent-comment-filter.mjs — 학부모 **댓글** 감지의 **순수 로직**(IO 없음 · Vitest 대상).
 *
 * 글(parent-post-filter.mjs)과 갈라놓은 이유: 감지 방식이 근본적으로 다르다.
 * 글은 피드에 **새 행**으로 나타나므로 "마지막 본 id"(워터마크) 하나로 결정적이다. 반면 댓글은 **기존 행의
 * `num_comments`가 늘어나는 것**으로만 드러난다 — 전용 피드가 없다(2026-07-15 실측: `centers/{c}/comments/`,
 * `reports/comments/`, `feeds/` 전부 404. `activities/`는 200이지만 **항상 빈 배열**). 그래서 감지 =
 * **댓글 수 스냅샷 대조**뿐이고, 이 파일은 그 대조 규칙을 담는다.
 *
 * ClassNote 댓글 API 계약(2026-07-16 실측):
 *  - `GET /api/v1/reports/{id}/comments/` = 그 글의 댓글. DRF 봉투(count/next/previous/results).
 *  - **정렬 = id 내림차순**(최신 먼저) — 글 피드와 같다. ⚠️ "오래된 것부터"로 가정하면 새 댓글 판별이 뒤집힌다.
 *  - `num_comments`(피드 행) == 실제 댓글 개수 — 표본 전건 일치. 대댓글·삭제분이 섞여 어긋나지 않는다.
 *  - `author.type` ∈ {admin, teacher, parent}. **강사 답글도 num_comments를 올린다** → 수 변화 ≠ 학부모 댓글.
 *  - 첨부 = `attached_images[]` / `attached_files[]` / `attached_video`, 스티커 = `emoticon_content`.
 */

/**
 * ClassNote 댓글(필요한 필드만).
 * @typedef {{ id: number, created?: string, author?: { type?: string }, content?: string,
 *             emoticon_content?: unknown, attached_images?: unknown[], attached_files?: unknown[],
 *             attached_video?: unknown }} Comment
 */

/**
 * 감시 창의 피드 행 → **댓글 수가 변한 글**만 추린다.
 *
 * ⚠️ **처음 보는 글은 절대 알리지 않는다**(`knownCount`가 없음 = 그 글의 기존 댓글은 우리가 켜지기 전 것).
 * 이게 콜드 스타트 방어다 — 첫 실행에 창 안의 댓글 수백 건이 통째로 벨에 쏟아지면 안 된다.
 * 글 감지의 워터마크 초기화와 같은 역할이되, **추가 요청이 0**이다(댓글 수가 피드 행에 이미 들어 있으므로
 * 댓글 API를 한 번도 안 부르고 스냅샷을 만든다).
 *
 * @param {Array<{id:number, class_name?:string, num_comments?:number}> | null | undefined} rows - 피드 행(전 보드)
 * @param {Record<string, number> | null | undefined} counts - 지난 스냅샷 {글id: 댓글수}
 * @param {{ prefix?: string }} [opts] - prefix = 대상 보드(`(수학)`). 다른 과목 보드는 창에서 제외.
 * @returns {{ changed: Array<{id:number, className:string, knownCount:number, count:number}>,
 *             nextCounts: Record<string, number>, firstSeen: number }}
 *   nextCounts = **창 안 전 글의 현재 댓글 수**(changed 포함). 댓글 조회가 실패·불완전하면 호출부가
 *   해당 항목만 knownCount로 되돌린다(그러면 다음 폴에 다시 잡힘) — `selectNewComments`의 incomplete 참조.
 */
export function selectChangedReports(rows, counts, { prefix } = {}) {
  const prev = counts ?? {};
  const changed = [];
  /** @type {Record<string, number>} */
  const nextCounts = {};
  let firstSeen = 0;
  for (const r of rows ?? []) {
    const id = Number(r?.id);
    if (!Number.isFinite(id)) continue;
    const className = String(r?.class_name ?? "");
    if (prefix && !className.startsWith(prefix)) continue;
    const count = Number(r?.num_comments ?? 0);
    if (!Number.isFinite(count)) continue;
    nextCounts[String(id)] = count;
    const known = prev[String(id)];
    if (known === undefined) {
      firstSeen++; // 처음 보는 글 — 기존 댓글은 우리 켜기 전 것이므로 알리지 않고 기준선만 잡는다
      continue;
    }
    if (Number(known) !== count) changed.push({ id, className, knownCount: Number(known), count });
  }
  return { changed, nextCounts, firstSeen };
}

/**
 * 한 글의 댓글 목록 → **새로 달린 학부모 댓글**.
 *
 * 판별 규칙 = **id 오름차순으로 정렬해 앞의 `knownCount`개를 건너뛴다.** 댓글 id는 전역 증가라(실측
 * 774691764~776262898) 오름차순 = 작성 순서고, 우리가 이미 아는 건 앞의 knownCount개다.
 *
 * ⚠️ 왜 "워터마크(마지막 본 댓글 id)"를 안 쓰나: 그러면 **콜드 스타트에 창 안 모든 글의 댓글을 한 번씩 열어야**
 * 기준 id를 알 수 있다(실측 77건 = 요청 77회 버스트). 반면 이 규칙은 피드의 `num_comments`만으로 기준선이
 * 잡혀 **추가 요청 0**이다.
 *
 * ⚠️ 삭제에 self-correcting이다: [10,20,30](known=3)에서 20이 지워지면 수가 2로 **변하므로** 조회 →
 * slice(3) of 2개 = 0건 알림(정상) → known=2로 갱신. 이어 40이 달리면 2→3 변화 → slice(2) = [40] 알림(정상).
 * 못 잡는 유일한 경우는 **한 폴 안에서 삭제+추가로 수가 그대로**인 때(수 변화가 없어 조회 자체를 안 함).
 * 학부모가 10분 안에 지우고 새로 다는 경우라 사실상 없고, 있어도 미알림(오알림 아님)이라 안전한 방향이다.
 *
 * @param {Comment[] | null | undefined} list - 그 글의 댓글 전건(API는 id desc — 여기서 asc로 다시 정렬한다)
 * @param {{ knownCount: number, actualCount: number, nowMs?: number, maxAgeDays?: number }} opts
 *   actualCount = 피드가 말한 현재 댓글 수. list 길이와 다르면 **전건을 못 본 것** → incomplete.
 * @returns {{ picked: Comment[], tooOld: Comment[], incomplete: boolean }}
 */
export function selectNewComments(list, { knownCount, actualCount, nowMs = Date.now(), maxAgeDays = 3 } = {}) {
  const all = [...(list ?? [])].filter((k) => Number.isFinite(Number(k?.id)));
  // 전건을 못 봤으면(페이지네이션 밖 / 조회와 피드 사이에 새 댓글이 끼어듦) **추측하지 않는다**.
  // 호출부가 knownCount를 되돌려 다음 폴에 다시 잡게 한다 — 여기서 slice를 강행하면 중간 댓글이 영영 샌다.
  if (all.length !== Number(actualCount)) return { picked: [], tooOld: [], incomplete: true };
  all.sort((a, b) => Number(a.id) - Number(b.id));
  const fresh = all.slice(Math.max(0, Number(knownCount) || 0));
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const picked = [];
  const tooOld = [];
  for (const k of fresh) {
    if (k?.author?.type !== "parent") continue; // 강사 답글도 num_comments를 올린다 — 여기서 걸러진다
    const t = Date.parse(k?.created ?? "");
    // age 가드 = 연동 PC가 며칠 꺼졌다 켜졌을 때 밀린 댓글이 벨을 도배하는 것 방지(글 감지와 같은 취지).
    if (Number.isFinite(t) && nowMs - t > maxAgeMs) {
      tooOld.push(k);
      continue;
    }
    picked.push(k);
  }
  return { picked, tooOld, incomplete: false };
}

/**
 * 스냅샷을 **가장 최근 글 `cap`개**로 자른다 — 안 자르면 jsonb가 영원히 커진다.
 *
 * ⚠️ cap은 반드시 **감시 창보다 넉넉히** 커야 한다. 창 안 글이 잘려나가면 다음 폴에 "처음 보는 글"로
 * 되살아나 기준선만 다시 잡고(=알림 0) 그 사이 달린 댓글을 조용히 놓친다.
 *
 * @param {Record<string, number> | null | undefined} counts
 * @param {number} cap
 * @returns {Record<string, number>}
 */
export function pruneCounts(counts, cap) {
  const entries = Object.entries(counts ?? {});
  if (entries.length <= cap) return { ...(counts ?? {}) };
  entries.sort((a, b) => Number(b[0]) - Number(a[0])); // 글 id 내림차순 = 최신 우선
  return Object.fromEntries(entries.slice(0, cap));
}

/**
 * 알림 문구 — 강사가 벨에서 **본문을 바로 읽고 판단**할 수 있어야 한다(ClassNote 앱을 안 열어도 되는 게 요점).
 * 글 알림(`buildNotificationText`)과 같은 규칙이되 제목만 "학부모 댓글"로 구분한다.
 *
 * @param {Comment} comment
 * @param {string} studentName
 * @returns {{ title: string, body: string }}
 */
export function buildCommentNotificationText(comment, studentName) {
  const text = String(comment?.content ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const bits = [];
  const imgs = (comment?.attached_images ?? []).length;
  const files = (comment?.attached_files ?? []).length;
  if (imgs) bits.push(`사진 ${imgs}장`);
  if (files) bits.push(`파일 ${files}개`);
  if (comment?.attached_video) bits.push("영상");
  if (comment?.emoticon_content) bits.push("스티커");
  const attach = bits.length ? `[${bits.join("·")}] ` : "";
  const body = text
    ? `${attach}${text.length > 200 ? text.slice(0, 200) + "…" : text}`
    : bits.length
      ? `${attach}(내용 없이 첨부만)`
      : "학부모님이 댓글을 남겼습니다";
  return { title: `${studentName} 학부모 댓글`, body };
}

/**
 * 글자 없이 첨부만 있는 학부모 글·댓글의 **저장용 대체 원문**(예 `[영상] (내용 없이 첨부만)`) — 없으면(글자가 있거나 첨부도 없으면) null.
 * 알림 본문(`buildCommentNotificationText`)과 **같은 문구**라 벨 알림 ↔ 저장 행 짝짓기(`notificationBodyMatches`)가 글자 그대로 맞는다.
 * 🔴 이 값은 원문이 아니라 "첨부가 있다"는 **사실 표시**다 — AI 출결 분류에 보내지 않는다(저장 시 분류 끝 처리, classnote-inbox-store).
 * @param {Comment & { emoticon_content?: unknown }} item
 * @returns {string | null}
 */
export function attachOnlyText(item) {
  const text = String(item?.content ?? "").replace(/\s+/g, " ").trim();
  if (text) return null;
  const { body } = buildCommentNotificationText(item, "");
  return body.endsWith("(내용 없이 첨부만)") ? body : null;
}

/** 사진 주소로 받아들이는 호스트 — ClassNote 업로드 CDN(kage = kakao). 그 밖의 주소는 저장하지 않는다(화면이 `<img>`로 불러오는 주소라 임의 주소를 들이지 않는다). */
const IMAGE_HOST = /(^|\.)(kakao\.com|kakaocdn\.net)$/i;
const MAX_IMAGES = 10;

/**
 * 학부모 글·댓글의 **사진 주소**(`attached_images[]` — 2026-10-01 실측: 항목에 `original·large·small` 주소, 서명·만료 쿼리 없음·무로그인 GET 206·max-age 10년).
 * 화면은 작은 것(`small`)을 격자로, 누르면 큰 것(`large`)을 띄운다. 원본(`original`)은 크기가 커서 저장하지 않는다.
 * @param {{ attached_images?: unknown[] }} item
 * @returns {{ small: string, large: string, width: number | null, height: number | null }[]}
 */
export function imageAttachments(item) {
  const ok = (v) => {
    try {
      const u = new URL(String(v));
      return u.protocol === "https:" && !u.username && !u.password && IMAGE_HOST.test(u.hostname) ? u.href : null;
    } catch {
      return null;
    }
  };
  const out = [];
  for (const img of Array.isArray(item?.attached_images) ? item.attached_images : []) {
    const large = ok(img?.large) ?? ok(img?.large_resize) ?? ok(img?.original);
    const small = ok(img?.small) ?? ok(img?.small_resize) ?? large;
    if (!large || !small) continue;
    const w = Number(img?.width);
    const h = Number(img?.height);
    out.push({ small, large, width: Number.isFinite(w) && w > 0 ? w : null, height: Number.isFinite(h) && h > 0 ? h : null });
    if (out.length >= MAX_IMAGES) break;
  }
  return out;
}
