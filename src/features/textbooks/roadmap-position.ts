/** 로드맵 보조 — 기준일이 든 창 · 시리즈의 최근 진도 위치(순수 함수, book-roadmap.ts가 쓴다). */
import { bookKey, bookPosition, catalogCandidates, lessonNoOf, unitKey, type CatalogBook, type ReportLine } from "./math-book-match";
import { keyOrdinal, seriesOfKey } from "./book-sequence";
import type { PlacedBook } from "./roadmap-calendar";
import type { RoadPosition } from "./book-roadmap-types";

export function windowAt(books: readonly PlacedBook[], ref: string): number {
  // 뒤에서부터 — 재계산으로 끝난 권들이 오늘에 겹쳐 있으면 마지막(= 지금 권)이 이긴다.
  const hit = books.findLast((b) => b.startDate <= ref && ref <= b.finishDate);
  if (hit) return hit.window;
  return ref < books[0]!.startDate ? 0 : books[books.length - 1]!.window;
}

/**
 * 시리즈 교재 중 진도가 걸린 **가장 최근** 기록(같은 날 두 권에 걸리면 아래 순서).
 * 🔑 교재 칸에 **다른 책**이 적힌 기록은 **앞으로 나갈 때만** 센다 — 내신 기간에 `중2-2 100발 100중`으로 지난 단원을
 *    복습하면 그 단원 이름이 가우스 중2-2 차시표에 걸려 중3을 나가는 학생의 '현재'가 중2-2로 되돌아갔다(원장
 *    2026-10-26 제보). 그렇다고 다른 책 기록을 통째로 빼면 같은 단원을 개념원리·쎈으로 나가는 학생의 위치가 사라진다
 *    (실데이터 드라이런에서 수십 명). 그래서: 시리즈가 적힌(또는 교재 칸이 빈) 기록의 위치가 기준이고, 다른 책 기록은
 *    그보다 **새롭고 앞선** 위치일 때만 이긴다. 시리즈 기록이 하나도 없으면 다른 책 기록으로 본다(종전 그대로).
 * 🔑 같은 기록이 두 권에 걸리면(`대푯값과 산포도` = 중1-2 4권·중3-2 4권, `인수분해` = 중3-1 1권·공통수학1) **교재 칸이
 *    가리키는 권 → 같은 학년·학기 권 → 뒤 권** 순으로 고른다. 뒤 권만 보면 중1 학생이 중3으로 튄다.
 */
export function latestPosition(series: string, catalog: readonly CatalogBook[], reports: readonly ReportLine[]): RoadPosition | null {
  const loose = (s: string) => s.replace(/\s+/g, "");
  const own = reports.filter((r) => !r.textbook?.trim() || loose(r.textbook).includes(loose(series)));
  const mine = newestPosition(series, catalog, own);
  const any = own.length === reports.length ? mine : newestPosition(series, catalog, reports);
  if (!mine || !any) return mine ?? any;
  const ahead = keyOrdinal(any.key) > keyOrdinal(mine.key) || (any.key === mine.key && any.lessonNo > mine.lessonNo);
  return any.date > mine.date && ahead ? any : mine;
}

/**
 * 교재 칸에 적힌 학년·학기가 이 권과 맞는가 — 학년·학기가 안 적혔으면(`가우스 공통수학1`·`프린트`) 맞는 것으로 본다.
 * 학교급 없는 `6-2-1`·`3-2`는 학년·학기만 비교한다.
 */
export function termFits(textbook: string | null | undefined, key: string): boolean {
  const m = key.match(/\|([초중고])(\d)-(\d)\|/);
  if (!m) return true;
  const terms = [...(textbook ?? "").matchAll(/([초중고])?\s*(\d)\s*-\s*(\d)/g)];
  if (terms.length === 0) return true;
  return terms.some((t) => (!t[1] || t[1] === m[1]) && t[2] === m[2] && t[3] === m[3]);
}

function newestPosition(series: string, catalog: readonly CatalogBook[], reports: readonly ReportLine[]): RoadPosition | null {
  const head = (key: string | null) => key?.replace(/\|\d+$/, "") ?? null;
  // 그 날 그 권에 걸린 기록의 교재 칸이 이 권을 얼마나 가리키나 — 2 = 이 권, 1 = 같은 학년·학기, 0 = 근거 없음.
  const hint = (b: CatalogBook, key: string, date: string) => {
    let rank = 0;
    for (const r of reports) {
      if (r.date !== date || lessonNoOf(r.progress, b.lessons) == null) continue;
      const named = catalogCandidates(r.textbook, catalog);
      if (named.some((c) => c.id === b.id)) return 2;
      if (named.some((c) => head(bookKey(c)) === head(key))) rank = 1;
    }
    return rank;
  };
  // 🔑 같은 이름의 단원이 **여러 학년·학기**에 있으면(`공배수와 최소공배수` = 초5-1 · 중1-1, `다각형` = 초4-2 · 중1-2)
  //    진도만으로는 어느 권인지 모른다 → 그때만 교재 칸의 학년·학기로 가른다. `시그마 중1-1`로 한 그 단원이 초5-1 발전
  //    1권 5차시에 걸려, 초6-2를 시작한 학생이 '현재 초5-1'로 보였다(원장 2026-10-26 제보).
  //    한 학년에만 있는 단원(`원주와 원주율 알아보기`)은 진도를 믿는다 — 교재 칸이 새 책으로 미리 채워진 채 옛 책 진도를
  //    적은 기록이 실제로 많다(`가우스 중1-1 1권` + 초6-2 단원).
  const termsOfUnit = new Map<string, Set<string>>();
  for (const c of catalog) {
    const h = head(bookKey(c));
    if (!h) continue;
    for (const l of c.lessons) {
      for (const u of (l.progress ?? "").split(" / ")) {
        if (!u.trim()) continue;
        const k = unitKey(u);
        (termsOfUnit.get(k) ?? termsOfUnit.set(k, new Set()).get(k)!).add(h.replace(/^[^|]*\|/, ""));
      }
    }
  }
  // 그 기록이 이 권에 걸린 줄이 **전부** 여러 학년에 있는 이름인가(한 줄이라도 이 학년에만 있으면 진도를 믿는다).
  const ambiguous = (progress: string | null, b: CatalogBook) => {
    const mine = new Set(b.lessons.flatMap((l) => (l.progress ?? "").split(" / ").map(unitKey)));
    const hits = (progress ?? "").split(/\r?\n/).map(unitKey).filter((k) => mine.has(k));
    return hits.length > 0 && hits.every((k) => (termsOfUnit.get(k)?.size ?? 0) > 1);
  };
  let best: { pos: RoadPosition; book: CatalogBook } | null = null;
  for (const b of catalog) {
    const key = bookKey(b);
    if (!key || seriesOfKey(key) !== series) continue;
    const p = bookPosition(b, reports.filter((r) => termFits(r.textbook, key) || !ambiguous(r.progress, b)), catalog);
    if (!p) continue;
    const pos = { key, title: b.title, lessonNo: p.lessonNo, total: p.total, date: p.date, unit: p.unit };
    if (!best || p.date > best.pos.date) best = { pos, book: b };
    else if (p.date === best.pos.date) {
      const h = hint(b, key, p.date);
      const bh = hint(best.book, best.pos.key, p.date);
      if (h > bh || (h === bh && keyOrdinal(key) > keyOrdinal(best.pos.key))) best = { pos, book: b };
    }
  }
  return best?.pos ?? null;
}
