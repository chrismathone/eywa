/**
 * 수학 교재 ↔ 보고서 기록 매핑 — 순수 함수(원장 2026-10-19 *"가우스 1,2,3,4권 맞춰서 해당 교재 쓰는 학생들
 * 연동만 하면 바로 볼 수 있잖아, 매핑만 하면"*).
 *
 * 두 갈래:
 *  ① **어느 교재인가** — 보고서 교재 칸은 사람마다 적는 법이 다르다(실측: `가우스 중2-2 3권` 210건 ·
 *     `가우스 중2-1-1권` 109건 · `가우스 중2-2-3권` · `가우스중2-1-2` …). 교재목록 이름
 *     (`가우스 중2-2 발전 3권`)과 글자로는 0건 일치라 **열쇠(시리즈·학교급·학년-학기·권)** 로 맞춘다.
 *  ② **몇 차수인가** — 보고서 진도(소단원 이름)를 그 교재 차수의 소단원 목록에서 찾는다. 번호 머리(`5-1.`)·
 *     과목 라벨(`수학 `)·띄어쓰기는 무시하고, 시트와 eywa 커리큘럼이 다르게 부르는 6개는 별칭으로 잇는다.
 *
 * 🔴 **모르면 맞추지 않는다** — 학교급(`중`)이 안 적힌 `가우스 2-2-3권`은 초등 교재와 구분이 안 돼 버린다.
 *    엉뚱한 교재가 붙는 것보다 "교재 미확인"이 낫다.
 */

import { courseOf, gradeTermKey, seriesFromTitle, validGradeTerm } from "./grade-term";

export { validGradeTerm };

export type BookLesson = { lessonNo: number; progress: string | null };
/** `gradeTerm` = 교재목록 학년·학기(`고1-1`). 있으면 제목 대신 이 값으로 줄을 세운다(고등 제목엔 학년이 없다). */
export type CatalogBook = { id: string; title: string; gradeTerm?: string | null; lessons: BookLesson[] };
export type ReportLine = { date: string; textbook: string | null; progress: string | null };

const LEVELS = "초중고";

/** `가우스 중2-1 발전 1권` / `가우스중2-2-3권` / `가우스 중 2-1 1권` → `가우스|중2-1|1`. 못 읽으면 null. */
function keyOf(segment: string, series: string): string | null {
  const s = segment.replace(/\s+/g, " ");
  if (!s.includes(series)) return null;
  const m = s.match(new RegExp(`([${LEVELS}])\\s*(\\d)\\s*-\\s*(\\d)(?:\\s*-\\s*|\\s+(?:발전|기본|심화)?\\s*)(\\d)\\s*권?`));
  if (!m) return null;
  return `${series}|${m[1]}${m[2]}-${m[3]}|${m[4]}`;
}

/** 교재목록 제목의 시리즈(학교급 앞 첫 낱말) — `가우스 중2-1 발전 1권` → `가우스`. */
function seriesOf(title: string): string | null {
  const m = title.trim().match(new RegExp(`^([^\\s${LEVELS}\\d][^\\s]*?)\\s*[${LEVELS}]\\s*\\d`));
  return m ? m[1]! : null;
}

/** 교재목록 교재 → 열쇠. 시리즈·학교급·학년-학기·권이 다 있어야 한다. */
export function catalogBookKey(title: string): string | null {
  const series = seriesOf(title);
  return series ? keyOf(title, series) : null;
}

/**
 * 교재 → 줄 세우는 열쇠. 🔑 **학년·학기가 적혀 있으면 그 값이 이긴다**(사람이 정한 사실 — 원장 2026-10-22
 * "교재 등록 시 수학은 학년도"), 없으면 제목에서 읽는다(종전 그대로).
 */
export function bookKey(book: { title: string; gradeTerm?: string | null }): string | null {
  return gradeTermKey(book) ?? catalogBookKey(book.title);
}

const looseTitle = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * 교재 칸이 가리킬 수 있는 교재들:
 *  ① 제목 글자 그대로(띄어쓰기·대소문자 무시) — makeedu 주문명은 교재목록 이름과 같다.
 *  ② 열쇠(시리즈·학교급·학년-학기·권) — `가우스 중2-1-2권` 같은 흔들린 표기.
 *  ③ 과목 이름(`가우스 공통수학1`) — 단원 묶음 권이 여럿이면 **여럿이 걸린다**(어느 권인지는 진도로 가른다).
 * 🔑 ①·②는 **합쳐서** 본다 — 한 칸에 두 책이 적혔는데 하나는 제목 그대로·하나는 흔들린 표기면 둘 다 걸려야
 *    "두 권이면 고르지 않는다"가 산다. ③은 ①·②가 하나도 없을 때만(약한 근거라 강한 근거를 흐리지 않게).
 */
export function catalogCandidates<T extends { title: string; gradeTerm?: string | null }>(
  text: string | null | undefined,
  catalog: readonly T[],
): T[] {
  if (!text) return [];
  const segments = text.split(/[\n\r,/·]+/).map((x) => x.trim()).filter(Boolean);
  const loose = segments.map(looseTitle);
  const strong = new Set<T>();
  const course = new Set<T>();
  for (const book of catalog) {
    if (loose.includes(looseTitle(book.title))) {
      strong.add(book);
      continue;
    }
    const series = seriesOf(book.title) ?? (validGradeTerm(book.gradeTerm) ? seriesFromTitle(book.title) : null);
    const key = catalogBookKey(book.title) ?? gradeTermKey(book);
    if (series && key && segments.some((seg) => keyOf(seg, series) === key)) {
      strong.add(book);
      continue;
    }
    const c = courseOf(book);
    if (c && loose.includes(looseTitle(c))) course.add(book);
  }
  return [...(strong.size > 0 ? strong : course)];
}

/**
 * 보고서 교재 칸 → 교재목록 교재. 한 칸에 여러 책이 적힌 경우(`가우스 중2-1-2권, 쎈 연산`)는 조각마다 본다.
 * 두 권 이상이 걸리면(조각마다 다른 교재 · 과목 이름만 적혀 권을 모름) **고르지 않는다**(null).
 */
export function matchCatalogBook<T extends { title: string; gradeTerm?: string | null }>(
  text: string | null | undefined,
  catalog: readonly T[],
): T | null {
  const hits = catalogCandidates(text, catalog);
  return hits.length === 1 ? hits[0]! : null;
}

/** 같은 과목의 권들인가 — 열쇠에서 권만 뗀 값이 모두 같다(`가우스|고1-1|1`·`…|2`). */
function sameCourse(books: readonly { title: string; gradeTerm?: string | null }[]): boolean {
  const heads = new Set(books.map((b) => bookKey(b)?.replace(/\|\d+$/, "") ?? null));
  return heads.size === 1 && !heads.has(null);
}

/**
 * 교재 칸이 이 교재를 가리키는가 — 하나로 정해지면 그 교재, 과목 이름만 적혀 **같은 과목의 권들**이 걸리면
 * 그중 하나로도 본다(어느 권인지는 진도로 가른다). 다른 과목·다른 책이 섞이면 아니다.
 */
function textPointsTo(book: CatalogBook, text: string | null | undefined, catalog: readonly CatalogBook[]): boolean {
  const hits = catalogCandidates(text, catalog);
  if (hits.length === 1) return hits[0]!.id === book.id;
  return hits.some((h) => h.id === book.id) && sameCourse(hits);
}

/**
 * 시트(교재 목차)와 eywa 커리큘럼이 다르게 부르는 소단원 — 정규화된 이름끼리 잇는다(양쪽 다 eywa 이름으로 접는다).
 * 출처: 가우스 중2-2 발전 3·4권 매핑 결과(2026-10-19). 보고서엔 오른쪽 이름이 쓰인다(직사각형… 23건 등).
 */
const UNIT_ALIASES: Record<string, string> = {
  "여러가지사각형(직사각형,마름모,정사각형)": "직사각형,마름모,정사각형",
  "여러가지사각형(등변사다리꼴,사각형의포함관계)": "등변사다리꼴,여러가지사각형",
  "평행선과넓이": "평행선과삼각형의넓이",
  "삼각형과평행선": "삼각형에서평행선사이의선분의길이의비",
  "평행선과선분의길이의비": "평행선사이의선분의길이의비",
  "피타고라스정리를이용한성질": "피타고라스정리의활용",
  // 중3 — eywa 커리큘럼은 소단원을 굵게 묶어 부른다(`근호를 포함한 식의 계산` = 1-4·1-5·1-6). 묶음에 든 교재 소단원을
  // 모두 그 이름으로 접으면 그 묶음의 **가장 뒤 차수**가 걸린다(가우스 중3-1·중3-2 차시표, 2026-10-26 — 그전엔 0% 매칭).
  "제곱근의뜻과표현": "제곱근의뜻과성질",
  "제곱근의성질": "제곱근의뜻과성질",
  "제곱근의곱셈과나눗셈": "근호를포함한식의계산",
  "제곱근의덧셈과뺄셈": "근호를포함한식의계산",
  "제곱근의값": "근호를포함한식의계산",
  "다항식의곱셈의응용": "다항식의곱셈",
  "이차방정식과그해": "이차방정식의풀이",
  "인수분해를이용한이차방정식의풀이": "이차방정식의풀이",
  "제곱근을이용한이차방정식의풀이": "이차방정식의풀이",
  "이차방정식의근의공식": "이차방정식의근의공식과응용",
  "이차방정식의응용": "이차방정식의근의공식과응용",
  "이차방정식의활용(수,실생활,쏘아올린물체등)": "이차방정식의활용",
  "이차방정식의활용(도형)": "이차방정식의활용",
  "이차함수y=ax²의그래프": "이차함수와그래프",
  "이차함수y=ax²+q,y=a(x-p)²의그래프": "이차함수와그래프",
  "이차함수y=a(x-p)²+q의그래프": "이차함수와그래프",
  "이차함수y=ax²+bx+c의그래프(1)": "이차함수y=ax^2+bx+c의그래프",
  "이차함수y=ax²+bx+c의그래프(2)": "이차함수y=ax^2+bx+c의그래프",
  "삼각비": "삼각비의뜻",
  "특수각의삼각비의값": "삼각비의값",
  "임의의예각의삼각비의값": "삼각비의값",
  "길이구하기": "삼각비의활용",
  "넓이구하기": "삼각비의활용",
  "원의접선(1)": "원의접선",
  "원의접선(2)": "원의접선",
  "원과사각형": "원주각의활용",
  "접선과현이이루는각": "원주각의활용",
  "대푯값": "대푯값과산포도",
  "산포도와표준편차": "대푯값과산포도",
};

/**
 * 소단원 이름 비교 키 — 번호 머리(`5-1.`·`1.`·점 없는 `1-3 `)·과목 라벨(`수학`)·띄어쓰기·`(단원)`을 걷고 별칭으로 접는다.
 * ⚠️ 점 없는 번호는 **하이픈이 있을 때만** 뗀다 — `1 m보다 긴 길이`의 `1`은 번호가 아니다.
 */
export function unitKey(name: string): string {
  const k = name
    .trim()
    .replace(/^수학\s+/, "")
    .replace(/^\d+(?:-\d+)*\.\s*|^\d+(?:-\d+)+\s+/, "")
    .replace(/\(단원\)/g, "단원")
    .replace(/\s+/g, "");
  return UNIT_ALIASES[k] ?? k;
}

/** 보고서 진도 → 그 교재의 차수와 그 차수를 준 줄. 여러 줄이면 걸리는 차수 중 **가장 뒤**(그날 마지막으로 나간 곳). */
function matchLesson(progress: string | null | undefined, lessons: readonly BookLesson[]): { no: number; line: string } | null {
  if (!progress) return null;
  const index = new Map<string, number>();
  for (const l of lessons) {
    for (const unit of (l.progress ?? "").split(" / ")) if (unit.trim()) index.set(unitKey(unit), l.lessonNo);
  }
  let best: { no: number; line: string } | null = null;
  for (const line of progress.split(/\r?\n/)) {
    const no = index.get(unitKey(line));
    if (no != null && (best == null || no > best.no)) best = { no, line: line.trim() };
  }
  return best;
}

export function lessonNoOf(progress: string | null | undefined, lessons: readonly BookLesson[]): number | null {
  return matchLesson(progress, lessons)?.no ?? null;
}

export type BookPosition = { lessonNo: number; total: number; date: string; unit: string };

/**
 * 그 교재에서 학생이 지금 몇 차수인가 — 기록을 최신순으로 보며 진도가 그 교재 차수에 걸리는 첫 기록.
 * `requireBookText`면 교재 칸까지 그 교재여야 센다(기록에서 교재를 추정한 경우 — 다른 책 진도가 섞이지 않게).
 */
export function bookPosition(
  book: CatalogBook,
  reports: readonly ReportLine[],
  catalog: readonly CatalogBook[],
  requireBookText = false,
): BookPosition | null {
  const sorted = [...reports].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const r of sorted) {
    if (requireBookText && !textPointsTo(book, r.textbook, catalog)) continue;
    const hit = matchLesson(r.progress, book.lessons);
    // 표시하는 소단원 = 그 차수를 준 줄(마지막 줄이 아니다 — 여러 줄이면 앞 줄이 더 뒤 차수일 수 있다).
    if (hit) return { lessonNo: hit.no, total: book.lessons.length, date: r.date, unit: hit.line.replace(/^수학\s+/, "") };
  }
  return null;
}

/** 기록에서 추정한 교재 — 최신 기록부터 보며 교재 칸이 교재목록 교재로 읽히는 첫 기록. */
export function inferBookFromReports(reports: readonly ReportLine[], catalog: readonly CatalogBook[]): CatalogBook | null {
  const sorted = [...reports].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  for (const r of sorted) {
    const hits = catalogCandidates(r.textbook, catalog);
    if (hits.length === 1) return hits[0]!;
    // 과목 이름만 적힌 칸(`가우스 공통수학1`) — 그날 진도가 걸리는 권이 하나면 그 권.
    if (hits.length > 1 && sameCourse(hits)) {
      const byProgress = hits.filter((b) => lessonNoOf(r.progress, b.lessons) != null);
      if (byProgress.length === 1) return byProgress[0]!;
    }
  }
  return null;
}
