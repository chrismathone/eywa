/**
 * scripts/_oneoff/import-textbooks-from-sheets.rules.mjs — ECS 계획 줄의 교재명 → `textbooks` 행 **변환 규칙**(순수).
 *
 * 스크립트(`import-textbooks-from-sheets.mjs`)와 Vitest(`src/features/textbooks/import-rules.test.ts`)가
 * **같은 파일**을 읽는다 — 규칙이 두 벌이면 "테스트는 통과인데 DB엔 다른 게 들어간다"가 된다.
 * 그래서 IO 없는 ESM으로 뽑아 뒀다(재고 가져오기 `inventory-import-rules.mjs` 선례).
 *
 * 규칙:
 *  - **이름은 절대 고치지 않는다.** `그래머인사이드 3`·`그래머인사이드3`은 두 행으로 들어간다.
 *    비슷한 이름은 `dupKey`로 묶어 **경고 목록**만 뽑고, 병합은 사람이 화면에서 한다(폐지→흡수).
 *  - `skill_area` = 그 교재가 가장 많이 쓰인 영역. 동률이면 `SKILL_AREA_ORDER` 순서가 이긴다(결정적).
 *  - `page_time` = **가장 흔한 `page_range`가 시간 모양일 때만**(`35분`). 그 교재의 최빈값이 쪽수·자유
 *    텍스트면 null이다 — 이 칸은 "이 교재는 한 차시에 몇 분"이라는 상수라, 쪽수가 들어가면 앞으로 만드는
 *    모든 시트 칸에 그 쪽수가 자동으로 박힌다.
 *  - `session_count` = 0. 차수별 진도·과제는 사람이 적는다(이 스크립트는 이름·구분·시간만 옮긴다).
 */

/** 동률일 때 이기는 순서(학원설정 기본 6영역의 순서 그대로). 목록 밖 값은 뒤로 보내고 사전순. */
export const SKILL_AREA_ORDER = ["vocab", "listening", "reading", "grammar", "writing", "speaking"];

/**
 * 교재가 아닌 값 — **정확히 일치하는 것만** 건너뛴다.
 * 🔴 똑똑한 필터를 만들지 말 것: `개별교재`가 들어간 실제 교재명이 생기면 조용히 사라진다.
 */
// ⚠️ `개별진도`(공백 없음)는 실데이터에 3건 있고 `개별 진도`(공백 있음)는 0건이다 — 둘 다 적어 둔다.
//    한 글자 차이로 교재 아닌 값이 마스터에 들어가던 자리(2026-09-16 드라이런에서 잡았다).
export const NON_BOOK_TITLES = new Set([
  "개별교재 / 개별진도",
  "개별교재/개별진도",
  "개별 진도",
  "개별진도",
  "JJ실",
]);

/** `35분`·`35 분` — 이 모양일 때만 page_time으로 옮긴다. */
export const DURATION_RE = /^(\d{1,3})\s*분$/;

export const SUBJECT = "english";

/** 교재가 아닌 값인가(한 글자짜리 잡음 포함). */
export function isNonBookTitle(title) {
  const t = (title ?? "").trim();
  if (t.length <= 1) return true;
  return NON_BOOK_TITLES.has(t);
}

/** `35 분` → `35분`. 시간 모양이 아니면 null. */
export function normalizeDuration(v) {
  const m = DURATION_RE.exec((v ?? "").trim());
  return m ? `${Number(m[1])}분` : null;
}

/**
 * 비슷한 이름 묶기용 키 — 소문자 + 공백·`·`·`.`·`-` 제거.
 * ⚠️ **비교 전용**이다. 저장되는 이름은 언제나 원문 그대로다.
 */
export function dupKey(title) {
  return (title ?? "").toLowerCase().replace(/[\s·.\-]/g, "");
}

/** 영역 카운트 → 대표 영역. 동률은 SKILL_AREA_ORDER, 그 밖은 사전순(결정적). */
export function dominantSkillArea(counts) {
  const entries = Object.entries(counts).filter(([area, n]) => area && n > 0);
  if (entries.length === 0) return null;
  const rank = (area) => {
    const i = SKILL_AREA_ORDER.indexOf(area);
    return i === -1 ? SKILL_AREA_ORDER.length : i;
  };
  entries.sort((a, b) => b[1] - a[1] || rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1));
  return entries[0][0];
}

/**
 * `page_range` 카운트 → page_time.
 * 🔴 **가장 흔한 값이 시간 모양일 때만** 돌려준다 — "시간 값 중에서 최빈"이 아니다. 쪽수를 주로 적는
 *    교재에 어쩌다 한 번 적힌 `15분`을 상수로 박으면 거짓이 된다.
 * 빈 값은 세지 않는다(안 적은 것은 값이 아니다). 동률이면 숫자가 작은 쪽(결정적).
 */
export function dominantPageTime(counts) {
  const entries = Object.entries(counts).filter(([v, n]) => (v ?? "").trim() !== "" && n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const [top] = entries;
  return normalizeDuration(top[0]);
}

/**
 * 계획 줄 → 교재별 집계.
 * @param rows `{ textbook, skill_area, page_range }[]`
 * @returns Map<원문 제목, { title, count, areas, pages }>
 */
export function aggregatePlanLines(rows) {
  const out = new Map();
  for (const r of rows ?? []) {
    const title = (r?.textbook ?? "").trim();
    if (title === "") continue;
    let agg = out.get(title);
    if (!agg) {
      agg = { title, count: 0, areas: {}, pages: {} };
      out.set(title, agg);
    }
    agg.count += 1;
    const area = (r.skill_area ?? "").trim();
    if (area) agg.areas[area] = (agg.areas[area] ?? 0) + 1;
    const page = (r.page_range ?? "").trim();
    if (page) agg.pages[page] = (agg.pages[page] ?? 0) + 1;
  }
  return out;
}

/** 한 교재 집계 → DB 행(원문 이름 그대로). */
export function toTextbookRow(agg) {
  return {
    subject: SUBJECT,
    skill_area: dominantSkillArea(agg.areas),
    title: agg.title,
    page_time: dominantPageTime(agg.pages),
    session_count: 0,
  };
}

/**
 * 가져오기 계획.
 * @param aggregates `aggregatePlanLines`의 결과
 * @param existingKeys 이미 있는 제목의 `lower(btrim(title))` 집합(유니크 인덱스와 같은 키)
 * @param minCount 임계값
 */
export function planImport({ aggregates, existingKeys, minCount }) {
  const insert = [];
  const skipExisting = [];
  const skipBelowMin = [];
  const skipNonBook = [];

  for (const agg of [...aggregates.values()].sort((a, b) => b.count - a.count || (a.title < b.title ? -1 : 1))) {
    if (isNonBookTitle(agg.title)) {
      skipNonBook.push(agg);
      continue;
    }
    if (agg.count < minCount) {
      skipBelowMin.push(agg);
      continue;
    }
    if (existingKeys.has(agg.title.trim().toLowerCase())) {
      skipExisting.push(agg);
      continue;
    }
    insert.push({ ...toTextbookRow(agg), _count: agg.count });
  }

  // 표에 들어갈 이름(새로 넣을 것 + 이미 있는 것)끼리만 비슷한 이름을 묶는다 —
  // 임계값 아래 이름은 애초에 표에 안 들어가므로 경고를 어지럽히지 않는다.
  const clusters = new Map();
  for (const agg of [...insert.map((r) => ({ title: r.title, count: r._count })), ...skipExisting]) {
    const key = dupKey(agg.title);
    clusters.set(key, [...(clusters.get(key) ?? []), agg]);
  }
  const dupClusters = [...clusters.values()]
    .filter((list) => new Set(list.map((a) => a.title)).size > 1)
    .sort((a, b) => b.length - a.length);

  return { insert, skipExisting, skipBelowMin, skipNonBook, dupClusters };
}
