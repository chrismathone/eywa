/**
 * 교재목록 학년·학기(`textbooks.grade_term`) — 제목에 학년이 없는 교재(고등 `가우스 공통수학1 01. …`)도
 * 진도 카드 순서에 세우는 열쇠 재료(원장 2026-10-22 *"교재 등록 시 수학은 학년도 넣는게 나을듯"*). 순수 함수.
 */

/** 학년·학기 값 — `초3-1`·`중2-2`·`고1-1`만 받는다. */
export function validGradeTerm(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return /^[초중고][1-6]-[12]$/.test(t) ? t : null;
}

/**
 * 학년·학기가 적힌 교재의 시리즈 = 제목에서 학년 표기·권·번호·괄호를 걷은 **첫 낱말**
 * (`가우스 공통수학1 01. …` → `가우스` · `초3-1 발전 1권 (22개정)` → `발전`).
 */
export function seriesFromTitle(title: string): string | null {
  for (const w of title.replace(/\([^)]*\)/g, " ").split(/\s+/)) {
    if (!w || /^[초중고]\d/.test(w) || /^\d/.test(w) || /권$/.test(w)) continue;
    return w;
  }
  return null;
}

/** 권 — `N권`이 있으면 그것, 없으면 단원 번호(`01.`), 둘 다 없으면 1(한 권짜리). */
function volumeFromTitle(title: string): number {
  const v = title.match(/(\d+)\s*권/);
  if (v) return Number(v[1]);
  const n = title.match(/(?:^|\s)0?(\d)\s*\./);
  return n ? Number(n[1]) : 1;
}

/** 학년·학기로 만든 열쇠(없거나 시리즈를 못 읽으면 null). */
export function gradeTermKey(book: { title: string; gradeTerm?: string | null }): string | null {
  const term = validGradeTerm(book.gradeTerm);
  const series = term ? seriesFromTitle(book.title) : null;
  return term && series ? `${series}|${term}|${volumeFromTitle(book.title)}` : null;
}

/** 과목 이름 — 단원 번호로 나뉜 고등 교재의 앞부분(`가우스 공통수학1 01. 다항식~…` → `가우스 공통수학1`). */
export function courseOf(book: { title: string; gradeTerm?: string | null }): string | null {
  if (!validGradeTerm(book.gradeTerm)) return null;
  const m = book.title.match(/^(.*?)\s+0?\d\s*\./);
  return m && m[1]!.trim() ? m[1]!.trim() : null;
}
