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

export type BookLesson = { lessonNo: number; progress: string | null };
export type CatalogBook = { id: string; title: string; lessons: BookLesson[] };
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
 * 보고서 교재 칸 → 교재목록 교재. 한 칸에 여러 책이 적힌 경우(`가우스 중2-1-2권, 쎈 연산`)는 조각마다 본다.
 * 두 권 이상이 걸리면(조각마다 다른 교재) **고르지 않는다**(null).
 */
export function matchCatalogBook<T extends { title: string }>(text: string | null | undefined, catalog: readonly T[]): T | null {
  if (!text) return null;
  const segments = text.split(/[\n\r,/·]+/).map((x) => x.trim()).filter(Boolean);
  const hits = new Set<T>();
  for (const book of catalog) {
    const key = catalogBookKey(book.title);
    const series = seriesOf(book.title);
    if (!key || !series) continue;
    if (segments.some((seg) => keyOf(seg, series) === key)) hits.add(book);
  }
  return hits.size === 1 ? [...hits][0]! : null;
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
};

/** 소단원 이름 비교 키 — 번호 머리(`5-1.`·`1.`)·과목 라벨(`수학`)·띄어쓰기·`(단원)`을 걷고 별칭으로 접는다. */
export function unitKey(name: string): string {
  const k = name
    .trim()
    .replace(/^수학\s+/, "")
    .replace(/^\d+(?:-\d+)*\.\s*/, "")
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
    if (requireBookText && matchCatalogBook(r.textbook, catalog)?.id !== book.id) continue;
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
    const hit = matchCatalogBook(r.textbook, catalog);
    if (hit) return hit;
  }
  return null;
}
