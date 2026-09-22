/**
 * scripts/_classnote/english-posts-filter.mjs — 피드에서 **반 단위 알림장 작성일**만 추리는 순수 로직.
 *
 * IO(로그인·피드조회·DB)는 classnote-feed-core / classnote-read-core가 담당하고, "무엇을 작성으로
 * 볼 것인가"의 판단만 여기 모은다(parent-post-filter.mjs와 같은 순수/IO 분리 — 워커 파일은
 * playwright/postgres를 물고 있어 단위테스트가 불가).
 *
 * 왜 필요한가: 영어 강사는 ClassNote에 직접 쓰므로 aywa `lesson_reports`엔 안 남는다.
 * 피드가 3주치만 보여 시간이 지나면 사라지므로, 워커가 볼 때 날짜를 적재해 둔다.
 *
 * 피드 계약(parent-post-filter.mjs 주석 + 2026-07-22 실측):
 *   `author.type` ∈ {admin, teacher, parent} · `class_name` = 보드(반) 이름 · `created` = 작성 시각
 */

/** 수학 보드는 `(수학)학생이름` 규약 — 학생 단위라 반 작성률 대상이 아니다. */
const MATH_BOARD = /^\(\s*수학\s*\)/;

/**
 * 이 행이 "반 알림장 작성"인가.
 * - 학부모 글(parent)은 제외 — 작성률은 **강사/기관이 쓴 것**만 센다.
 * - 수학 보드 제외 — 그쪽은 `lesson_reports`가 이미 진실이다.
 * - 보드 이름이 비면 집계 불가.
 * @param {{author?:{type?:string}, class_name?:string, created?:string}|null|undefined} row
 */
export function isClassPost(row) {
  const type = row?.author?.type;
  if (type !== "teacher" && type !== "admin") return false;
  const board = String(row?.class_name ?? "").trim();
  if (!board || MATH_BOARD.test(board)) return false;
  return Boolean(kstDay(row?.created));
}

/**
 * 작성 시각 → KST 날짜(YYYY-MM-DD). 피드 `created`는 ISO UTC라 그대로 자르면 한국 새벽 글이
 * 전날로 밀린다. ⚠️ 작성률의 분모(수업 요일)가 KST라 분자도 반드시 KST여야 한다.
 * @returns {string|null} 파싱 실패 시 null
 */
export function kstDay(created) {
  if (!created) return null;
  const ms = Date.parse(String(created));
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 피드 → `[{ boardName, postedOn, postCount }]` (보드×날짜로 접음).
 * 같은 보드에 하루 여러 건이 올라와도 **한 행**이다 — 작성률은 건수가 아니라 "그날 썼는가"로 센다.
 * 정렬은 결정적(보드→날짜)이라 로그·테스트가 안정적이다.
 * @param {Array<object>|null|undefined} rows
 */
export function extractClassPostDays(rows) {
  const acc = new Map();
  for (const r of rows ?? []) {
    if (!isClassPost(r)) continue;
    const boardName = String(r.class_name).trim();
    const postedOn = kstDay(r.created);
    const key = `${boardName}::${postedOn}`;
    const cur = acc.get(key);
    if (cur) cur.postCount += 1;
    else acc.set(key, { boardName, postedOn, postCount: 1 });
  }
  return [...acc.values()].sort(
    (a, b) => a.boardName.localeCompare(b.boardName) || a.postedOn.localeCompare(b.postedOn),
  );
}
