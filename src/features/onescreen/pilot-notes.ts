/**
 * 항목별 보고서 글(`■ 제목\n본문`, math-report-pilot-sections.ts) → 학부모 카드가 그릴 조각. 순수 모듈(Vitest).
 *
 * 원장 2026-10-23 *"이거는 표형식이 아님"* → 시안 B(막대형 표) 확정 + *"표에맞게 밑에도 어느정도 디자인 맞춰서"*.
 * 글은 그대로 저장하고(원스크린 미리보기·ClassNote 본문은 글자), **학부모 카드(/r·인쇄 = ClassNote 게시 사진)** 만
 * 이 조각으로 진짜 표와 항목 블록을 그린다. 그래서 형식이 안 맞으면 null — 카드는 예전처럼 글을 그대로 보인다.
 */

import { PILOT_ALIAS_TITLES, PILOT_LEGACY_TITLES, PILOT_SECTION_TITLES, RETEST_MARK } from "./math-report-pilot";
import { LEVEL_NONE_SEP, LEVELS, type Level } from "./math-report-pilot-sections";

export type PilotNoteSection = { title: string; body: string };

/** `■ 제목` 줄로 시작하는 글이면 항목 목록, 아니면 null(손으로 쓴 글·다른 학생 글). */
export function parsePilotNotes(notes: string | null | undefined): PilotNoteSection[] | null {
  const t = (notes ?? "").replace(/\r\n?/g, "\n").trim();
  if (!t.startsWith("■ ")) return null;
  const out: PilotNoteSection[] = [];
  for (const chunk of t.split(/\n+(?=■ )/)) {
    const [head = "", ...rest] = chunk.split("\n");
    const title = head.replace(/^■\s*/, "").trim();
    if (!title) return null;
    out.push({ title, body: rest.join("\n").trim() });
  }
  return out;
}

/** 이 항목이 그 제목인가 — 이름을 바꾸기 전에 저장된 글(옛 제목)도 같은 항목으로 본다. */
export function isPilotTitle(title: string, key: keyof typeof PILOT_SECTION_TITLES): boolean {
  if (title === PILOT_SECTION_TITLES[key]) return true;
  const legacy = (PILOT_LEGACY_TITLES as Partial<Record<string, string>>)[key];
  if (legacy !== undefined && title === legacy) return true;
  const alias = (PILOT_ALIAS_TITLES as Partial<Record<string, string>>)[key];
  return alias !== undefined && title === alias;
}

/** EiE 일일 보고서 글인가 — '단어 테스트' 항목이 있으면(그 템플릿만 이 제목을 쓴다). 카드가 EiE 마크를 함께 단다. */
export function isEieDailySections(sections: PilotNoteSection[]): boolean {
  return sections.some((s) => s.title === PILOT_ALIAS_TITLES.daily);
}

/** 테스트 본문의 재시험 표시를 뗀다 — 맨 윗줄이 `[재시험]`이면 retest. */
export function splitRetest(body: string): { retest: boolean; body: string } {
  const lines = body.split("\n");
  if ((lines[0] ?? "").trim() !== RETEST_MARK) return { retest: false, body };
  return { retest: true, body: lines.slice(1).join("\n").trim() };
}

/** 시범 자동작성 글인가 — 아는 항목 제목이 하나라도 있으면. 손으로 '■'로 시작한 글을 시범 글로 오인하지 않게. */
export function isPilotReportSections(sections: PilotNoteSection[]): boolean {
  const keys = Object.keys(PILOT_SECTION_TITLES) as (keyof typeof PILOT_SECTION_TITLES)[];
  return sections.some((s) => keys.some((k) => isPilotTitle(s.title, k)));
}

/**
 * 맨 끝 '사랑의 한마디'를 떼어 낸다 — 학부모 카드가 그 항목을 **카드 맨 아래**(학습 추세·첨부 뒤)에 따로 세운다
 * (원장 2026-10-23 *"사랑의 한마디 맨아래로 위치 변경"*). 마지막 항목이 한마디가 아니면 note = null.
 */
export function splitPilotNote(sections: PilotNoteSection[]): { main: PilotNoteSection[]; note: PilotNoteSection | null } {
  const last = sections[sections.length - 1];
  if (last && isPilotTitle(last.title, "note")) return { main: sections.slice(0, -1), note: last };
  return { main: sections, note: null };
}

/** 표의 한 줄 — 등급이 있으면 `level`, 값이 없는 줄(숙제 없음·평가 없음, 2026-10-26)은 `level: null` + 그 표기 `none`. */
export type LevelRow = { label: string; level: Level; none?: undefined } | { label: string; level: null; none: string };

const MARK = /[○●]/;

/**
 * '수업 평가' 본문 → 줄 목록. 눈금 기호(○●)가 있는 줄만 읽는다 — 머리 줄('구분…')·옛 안내 줄('(왼쪽부터…)')은 건너뛴다.
 * 이름 = 첫 기호 앞, 등급 = 마지막 기호 뒤(전각·반각 공백 무시). 등급이 눈금 밖이면 null(표를 지어내지 않는다).
 */
export function parseLevelRows(body: string): LevelRow[] | null {
  const rows: LevelRow[] = [];
  for (const line of body.split("\n")) {
    const first = line.search(MARK);
    if (first < 0) {
      // 값이 없는 줄 — `이름 — 숙제 없음`(levelTableText). 머리 줄('구분…')·옛 안내 줄엔 이 기호가 없어 건너뛴다.
      const sep = line.indexOf(LEVEL_NONE_SEP);
      if (sep < 0) continue;
      const label = line.slice(0, sep).replace(/[\s　]+/g, " ").trim();
      const none = line.slice(sep + LEVEL_NONE_SEP.length).trim();
      if (!label || !none) return null;
      rows.push({ label, level: null, none });
      continue;
    }
    const last = Math.max(line.lastIndexOf("○"), line.lastIndexOf("●"));
    const label = line.slice(0, first).replace(/[\s　]+/g, " ").trim();
    const level = line.slice(last + 1).replace(/[\s　]+/g, "");
    if (!label || !(LEVELS as readonly string[]).includes(level)) return null;
    rows.push({ label, level: level as Level });
  }
  return rows.length ? rows : null;
}

/** 테스트 항목 첫 줄이 점수("N문제 중 M개 맞음")인가 — 카드가 그 줄만 굵게 세운다. */
export function isScoreLine(line: string): boolean {
  return parseScoreLine(line) != null;
}

/** 점수 줄 → 맞힌 수 / 전체(카드의 점수 블록 재료). 형식이 아니거나 맞힌 수가 전체보다 크면 null. */
export function parseScoreLine(line: string): { right: number; total: number } | null {
  const m = line.trim().match(/^(\d+)문제 중 (\d+)개 맞음$/);
  if (!m) return null;
  const total = Number(m[1]);
  const right = Number(m[2]);
  return total > 0 && right <= total ? { right, total } : null;
}

/**
 * 학부모 문구 칸에서 맨 위 '수업 평가' 표를 떼어 낸다(원장 2026-10-26 *"우리수업평가 저부분은 어차피 수정할일없는데 수정영역에서
 * 제외하고 보여주는게 맞는거같다"*). 표는 고른 값(태도·숙제·이해도)에서 코드가 만든 것이라 손으로 고칠 일이 없고, 전각 공백 정렬이라
 * 칸에서 만지면 줄이 깨진다. 화면은 `lead`를 읽기 전용으로 보이고 `body`만 편집 칸에 둔다 — 저장 글은 `joinLevelsLead`로 다시 붙인 그대로다.
 * 글이 표로 시작하지 않으면 lead = "" (손대지 않는다).
 */
export function splitLevelsLead(draft: string | null | undefined): { lead: string; body: string } {
  const d = (draft ?? "").replace(/\r\n?/g, "\n");
  const head = `■ ${PILOT_SECTION_TITLES.levels}\n`;
  if (!d.startsWith(head)) return { lead: "", body: d };
  const next = d.search(/\n+(?=■ )/);
  if (next < 0) return { lead: d.trimEnd(), body: "" };
  return { lead: d.slice(0, next), body: d.slice(next).replace(/^\n+/, "") };
}

/** 떼어 낸 표 + 고친 본문 → 저장 글. 표와 본문 사이는 항목 사이와 같은 빈 줄 하나. */
export function joinLevelsLead(lead: string, body: string): string {
  if (!lead) return body;
  return body.trim() ? `${lead}\n\n${body}` : lead;
}

/**
 * AI에 줄 '직전 표현' 참고 — 직전 보고서의 '오늘의 수업' 문단(원장 2026-10-26 *"직전에 쓴 표현이라면 조금 다른표현"*).
 * 🔴 **사실로 주지 않는다** — 지난 수업 이야기가 오늘 글에 섞이면 거짓이 된다. 표현을 피하라는 참고로만, 그 사실을 밝혀 준다.
 * 항목 글이 아니거나 그 문단이 없으면 "".
 */
export function prevPhrasingHint(prevNotes: string | null | undefined): string {
  const sections = parsePilotNotes(prevNotes);
  const body = sections?.find((s) => isPilotTitle(s.title, "understanding"))?.body.trim() ?? "";
  if (!body) return "";
  return [
    "[직전 보고서의 '오늘의 수업' 문단 — 사실이 아니라 표현 참고용입니다. 이 내용(지난 수업 이야기)을 오늘 글에 옮기지 마세요]",
    body.replace(/\s+/g, " ").slice(0, 600),
    "- 위 문단과 같은 문장·같은 표현·같은 문장 끝을 되풀이하지 말고, 오늘 사실을 다른 표현으로 쓰세요(매번 같은 말이 나가지 않게).",
  ].join("\n");
}
