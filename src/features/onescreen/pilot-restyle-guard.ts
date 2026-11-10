/**
 * 새 수학 보고서 — 사실 항목을 **선생님 말투로 다시 쓴 글**의 검사(원장 2026-10-28 *"오늘의 진도를 떠나서 다른 영역도 수정한 사람들
 * 있자나 그에 맞게 다 말투 언어 모두 학습"*). 순수 모듈(Vitest).
 *
 * 사실 항목은 코드가 값에서 만든다(원장 2026-10-26 — 사실을 지키려고). 말투를 입히는 AI는 **표현만** 바꿀 수 있고, 아래 검사 중 하나라도
 * 어기면 그 항목은 코드 글 그대로 둔다(항목 단위 — 한 항목이 틀려도 다른 항목은 쓴다). 제목·순서는 바꾸지 않는다.
 *
 * 🔑 다시 쓰는 항목 = 진도 · 일일 테스트 · 확인 테스트 · 수업 태도 · 숙제 완성도 · 오늘의 숙제.
 *    진도(원장 2026-10-30 *"진도 문장이 바뀌어도 숫자를 제외하고 어투 단어선택 어휘를 학습"*) = 소단원 이름(순서까지)·숫자·성격 말(복습·문제풀이)은
 *    그대로, 동사·어미만 선생님 말투로. 발송 게이트는 그 사실로 견준다(`progressSectionMatches`). 소단원 이름이 없는 첫 문장(멈춤 수업)은 안 다시 쓴다.
 *    빼는 항목: 출결(카드가 문장 머리로 출결 표시를 읽는다 —
 *    `attendanceMarkOf`) · 수업 평가(표) · 오늘의 수업(이미 AI) · 사랑의 한마디(선생님 원문).
 * 🔑 글자로 다시 읽히는 줄은 **잠근다**(AI에 안 준다): 테스트 첫 줄의 점수("N문제 중 M개 맞음" — 카드가 점수 블록으로 읽는다)와
 *    오늘의 숙제의 영상 줄("영상 숙제가 있습니다…" — 카드가 숙제 상자 밖으로 뺀다).
 */
import { PILOT_SECTION_TITLES, progressFacts } from "./math-report-pilot";
import { isScoreLine } from "./pilot-notes";

export const RESTYLE_TITLES: readonly string[] = [
  PILOT_SECTION_TITLES.progress,
  PILOT_SECTION_TITLES.daily,
  PILOT_SECTION_TITLES.check,
  PILOT_SECTION_TITLES.attitude,
  PILOT_SECTION_TITLES.homework,
  PILOT_SECTION_TITLES.homeworkToday,
];

const VIDEO_LINE = /^영상 숙제가 있습니다/;

function isLockedLine(title: string, line: string): boolean {
  const t = line.trim();
  if (title === PILOT_SECTION_TITLES.daily || title === PILOT_SECTION_TITLES.check) return isScoreLine(t);
  if (title === PILOT_SECTION_TITLES.homeworkToday) return VIDEO_LINE.test(t);
  return false;
}

/**
 * 항목 본문 → 잠근 앞줄 · 다시 쓸 글 · 잠근 뒷줄. 잠근 줄이 가운데 끼어 있으면(모양을 모른다) null — 그 항목은 다시 쓰지 않는다.
 */
export function splitLockedLines(title: string, body: string): { head: string[]; free: string; tail: string[] } | null {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && isLockedLine(title, lines[i])) i++;
  let j = lines.length;
  while (j > i && isLockedLine(title, lines[j - 1])) j--;
  const mid = lines.slice(i, j);
  if (mid.some((l) => isLockedLine(title, l))) return null;
  return { head: lines.slice(0, i), free: mid.join("\n").trim(), tail: lines.slice(j) };
}

export function joinLockedLines(parts: { head: string[]; free: string; tail: string[] }): string {
  return [...parts.head, parts.free, ...parts.tail].map((l) => l.trim()).filter(Boolean).join("\n");
}

const DIGITS = /\d+/g;
const EXACT_TOKENS = [
  /\d{1,2}\/\d{1,2}/g, // 10/30
  /\d{1,2}월\s*\d{1,2}일/g, // 10월 2일
  /p\.?\s*\d+(?:\s*[-~]\s*\d+)?/gi, // p93-99
  /\d+(?:\.\d+)?\s*%/g, // 90%
  /'[^'\n]+'|‘[^’\n]+’|"[^"\n]+"|“[^”\n]+”/g, // 따옴표 안 단원 이름
];
// 부정 — '않·못·없'과 띄어 쓴 '안'. '빠짐없이'처럼 긍정으로 굳은 말은 먼저 지운다(코드 문장 "빠짐없이 잘 해 왔습니다"가 부정으로 읽혔다).
const NEGATION = /않|못|없|(?:^|\s)안\s/;
const POSITIVE_IDIOMS = /빠짐없이|틀림없이|어김없이|문제없이|빈틈없이|끊임없이/g;
const hasNegation = (s: string) => NEGATION.test(s.replace(POSITIVE_IDIOMS, ""));
const squash = (s: string) => s.replace(/\s+/g, "");

/**
 * 다시 쓴 글을 받아도 되나. `mustKeep` = 선생님이 직접 적어 글에 그대로 들어간 말(태도 의견·미제출 사유·시험 안 친 사유) — 글자 그대로 남아야 한다.
 */
export function acceptRestyle(original: string, rewrite: string, mustKeep: readonly string[] = [], title?: string): boolean {
  const o = original.trim();
  const r = rewrite.trim();
  if (!o) return !r;
  if (!r) return false;
  if (r.includes("■") || r.includes("○○")) return false;
  const oLen = squash(o).length;
  const rLen = squash(r).length;
  if (rLen < oLen * 0.4 || rLen > oLen * 2.5) return false;
  // 숫자 — 원래 숫자는 전부 남고, 없던 숫자는 생기지 않는다.
  const oNums = new Set(o.match(DIGITS) ?? []);
  const rNums: string[] = r.match(DIGITS) ?? [];
  if (![...oNums].every((n) => rNums.includes(n))) return false;
  if (rNums.some((n) => !oNums.has(n))) return false;
  // 날짜·쪽수·퍼센트·따옴표 단원 이름 — 글자 그대로(띄어쓰기만 무시).
  const rSq = squash(r);
  for (const re of EXACT_TOKENS) {
    for (const tok of o.match(re) ?? []) if (!rSq.includes(squash(tok))) return false;
  }
  // 부정 — 있던 부정은 남고, 없던 부정은 생기지 않는다(했다 ↔ 안 했다 뒤집기 방지).
  if (hasNegation(o) !== hasNegation(r)) return false;
  for (const k of mustKeep) {
    const s = k.trim();
    if (s && o.includes(s) && !r.includes(s)) return false;
  }
  // 진도 — 소단원 이름은 순서까지 그대로(없던 이름도 안 된다), 성격 말(복습·문제풀이)은 있고 없음이 그대로(진도 ↔ 복습 뒤집기 방지).
  if (title === PILOT_SECTION_TITLES.progress) {
    const a = progressFacts(o);
    const b = progressFacts(r);
    if (a.quotes.join("\n") !== b.quotes.join("\n")) return false;
    if (a.modes.join() !== b.modes.join()) return false;
  }
  return true;
}

/** 이 고침이 말투만 바꿨나 — 진도의 소단원 이름·성격 말을 바꾼 고침은 사실을 고친 것이라 말투 예시로 쓰지 않는다(그대로 배우면 AI가 사실을 바꾸려 든다). */
export function isStyleOnlyEdit(title: string, before: string, after: string): boolean {
  if (title !== PILOT_SECTION_TITLES.progress) return true;
  const a = progressFacts(before);
  const b = progressFacts(after);
  return a.quotes.join("\n") === b.quotes.join("\n") && a.modes.join() === b.modes.join();
}

/** 다시 쓸 항목들 — 글에서 다시 쓸 수 있는 항목의 '다시 쓸 글'만 뽑는다(AI에 이것만 준다). */
export function restyleTargets(sections: ReadonlyArray<{ title: string; body: string }>): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  for (const s of sections) {
    if (!RESTYLE_TITLES.includes(s.title) || !s.body.trim()) continue;
    // 진도는 소단원 이름이 있는 글만 — 멈춤 수업('월말평가 수업을 했습니다')은 게이트가 글자로만 견준다.
    if (s.title === PILOT_SECTION_TITLES.progress && !progressFacts(s.body).quotes.length) continue;
    const parts = splitLockedLines(s.title, s.body);
    if (parts?.free) out.push({ title: s.title, text: parts.free });
  }
  return out;
}

/**
 * 다시 쓴 글을 항목에 끼운다 — 항목마다 검사(`acceptRestyle`)를 지난 것만, 그리고 **보낸 글과 지금 항목의 글이 같을 때만**
 * (보낸 뒤 글이 달라졌으면 그 다시 쓴 글은 다른 사실에 대한 것이다). 잠근 줄은 제자리에 그대로. 제목·순서는 그대로.
 */
export function applyRestyle<S extends { title: string; body: string }>(
  sections: readonly S[],
  sent: ReadonlyArray<{ title: string; text: string }>,
  rewrites: Readonly<Record<string, unknown>>,
  mustKeep: readonly string[] = [],
): S[] {
  const sentBy = new Map(sent.map((s) => [s.title, s.text]));
  return sections.map((s) => {
    const was = sentBy.get(s.title);
    const next = rewrites[s.title];
    if (was === undefined || typeof next !== "string") return s;
    const parts = splitLockedLines(s.title, s.body);
    if (!parts || parts.free !== was) return s;
    const clean = next.replace(/\r\n?/g, "\n").trim();
    if (!acceptRestyle(was, clean, mustKeep, s.title)) return s;
    return { ...s, body: joinLockedLines({ ...parts, free: clean }) };
  });
}

const sectionsOf = (text: string) => {
  const out = new Map<string, string>();
  const re = /^■\s*(.+?)\s*$/;
  let cur: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (cur !== null && !out.has(cur)) out.set(cur, buf.join("\n").trim());
  };
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(re);
    if (m) {
      flush();
      cur = m[1];
      buf = [];
    } else if (cur !== null) buf.push(line);
  }
  flush();
  return out;
};

/**
 * 사실 글(`factOriginal` — '오늘의 수업' 없이 같은 값으로 조립)을 미리 다시 써 둔 결과(`factRestyled`)를 **최종 글**에 옮긴다 —
 * AI의 '오늘의 수업' 호출과 말투 호출을 나란히 돌리려고(응답 시간 = 둘 중 긴 쪽). 최종 글의 그 항목이 사실 글과 **글자 그대로 같을 때만**
 * 바꾼다(다르면 다른 값으로 조립된 것이다). 다시 쓰는 항목(`RESTYLE_TITLES`)만.
 */
export function transplantRestyle(finalText: string, factOriginal: string, factRestyled: string): string {
  if (factOriginal === factRestyled) return finalText;
  const was = sectionsOf(factOriginal);
  const now = sectionsOf(factRestyled);
  let out = finalText;
  for (const title of RESTYLE_TITLES) {
    const a = was.get(title);
    const b = now.get(title);
    if (!a || !b || a === b) continue;
    const from = `■ ${title}\n${a}`;
    if (out.split(from).length !== 2) continue;
    out = out.replace(from, () => `■ ${title}\n${b}`);
  }
  return out;
}
