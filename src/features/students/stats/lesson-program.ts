/**
 * **수업명(청구 항목 이름) → 프로그램** — '지난 기록' 프로그램별 청구 학생(원장 2026-10-21 *"수학과 영어로 구분 못하나? 수업명 가지고?"*).
 * 청구 줄엔 반 연결이 없고(메이크에듀 수납명 그대로) 2025년 이전엔 수강 기록도 없어 **이름만으로** 가른다. 순수 함수(Vitest).
 * 나누는 칸은 재원생 프로그램과 같다(`program.ts` — EiE / 인재원 영어 / 수학 · 원장 2026-09-11) + 그 밖의 과목(설정 과목 키 그대로).
 *
 * 판정 순서:
 *  ① `[EiE]` 표시 = EiE(대소문자 무시 — `isEieLesson`).
 *  ② 이름에 과목 이름이 적혔다 — 학원 설정 과목 이름(한글은 글자 그대로 · 영문 이름·키는 낱말로만 — 'Mathew'는 수학이 아니다) + 영어 갈래
 *     이름. **두 과목이 적힌 이름(합반)은 모름**이고 강사 표시로도 정하지 않는다(한쪽으로 몰지 않는다).
 *  ③ 학년 + 머리글 규약('중등M'·'고등E'·'중2E' — M = 수학 · E = 영어) · 과목 낱말(`SUBJECT_WORDS` — 'Phonics'·'도형'·'대수'처럼 한 과목에서만
 *     쓰는 말) — 그 묶음이 설정에 있을 때만.
 *  ④ 강사 표시(사람 이름 모양만 — 영문 별명 'Brian' · 성으로 시작하는 세 글자 'OOO반'·'(OOO)' · 'OOOT' · 한 글자 '(유)') —
 *     **직원 정보**(표시 이름·영문 이름 → 담당 과목이 한 묶음인 직원)가 있으면 그 묶음, 없으면 같은 표시가 붙은 다른 수업명이 정해진 묶음이
 *     줄 수로도 수업명 수로도 **90% 이상**(서로 다른 수업명 2개 · 10줄 이상)일 때 그 묶음.
 *  ⑤ 강사 표시가 아무것도 못 가리키면 프로그램 낱말(세 글자 넘는 한글 낱말 · '[강아]' 같은 머리표)로 — 더 엄격하게(수업명 3개 이상).
 *     흔한 낱말('정규반'·'모의고사')은 두 과목에 다 나와 순도에 걸러진다. ④·⑤는 두 번 돈다(첫 번에 강사로 정해진 수업명이 프로그램 낱말을
 *     가르친다 — '[강아] 강의하는아이들 (김은정)' → 수학 → '[인재원] 강의하는아이들'도 수학).
 *  ⑥ 그 밖 = 모름(null) — 지어내지 않는다.
 * 영어 묶음은 `[EiE]` 표시가 없으면 **인재원 영어**다(`english-track.ts`의 비대칭 그대로 — 'EiE가 아닌 전부').
 * 같은 이름 목록·직원 정보면 같은 결과다(배우는 재료가 입력뿐). 다만 밤마다 기간이 밀려 이름 목록이 바뀌면 경계에 선 강사 표시는 바뀔 수 있다
 * — 그래서 임계값을 '수업명 수'로도 건다(큰 반 하나가 판정을 쥐지 않게 · 리뷰 2026-10-21).
 * ⚠️ 이름으로 가르는 것은 **지난 청구 기록**뿐이다 — 반의 프로그램은 `classes.english_track`이 진실이다(이름 판정 금지 · `english-track.ts`).
 */
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { subjectGroupOf, type ProgramSubject } from "@/features/students/enrollment/program";

/** 'eie' · 'injaewon' · 'math' 또는 그 밖의 과목 키(설정 키 그대로). */
export type LessonProgram = string;
export type LessonName = { name: string; weight: number };
/** 직원 한 명 — 이름들(표시 이름·영문 이름)과 담당 과목 키. 담당이 한 묶음일 때만 강사 표시를 가른다. */
export type LessonStaff = { names: readonly (string | null | undefined)[]; subjects: readonly string[] };

const LEVEL = "(?:초중등|초등|중등|고등|중고|예비중등|예비고등|예비고|예비중|고[1-3]|중[1-3]|초[1-6])";
const LETTER = new RegExp(`${LEVEL}\\s*\\d?\\s*([EM])(?![A-Za-z])`);
/** 과목 이름을 품었지만 과목이 아닌 낱말 — '중국어'의 '국어', '과학고'의 '과학'. */
const NOT_SUBJECT = ["중국어", "외국어", "한국어", "과학고", "수학여행"];
const WEEKDAYS = "월화수목금토일";
/** 한국 성(흔한 것) — 'OOO반'·'(OOO)'를 사람 이름으로 볼 때만('정규반'·'(월목)'·'의치대반'은 강사가 아니다). */
const SURNAMES = "김이박최정강조윤장임한오서신권황안송류유전홍고문양손배백허남심노하곽성차주우구민진나지엄채원천방공현함변염여추도석선설마길연위표명기반왕금옥육인맹제모탁국어은편용예봉경사부가복태판소라승동피감음빈호상범좌팽";
/** 한 과목에서만 쓰는 수업 낱말 → 묶음(설정에 그 묶음이 있을 때만) — 과목 이름이 안 적힌 옛 수업명('초5Bridge-TOP'·'[특강] 중1도형특강'). */
const SUBJECT_WORDS: readonly [RegExp, string][] = [
  [/phonics|bridge|브릿지|reading|리딩|영문법|영특/i, "english"],
  [/수\((?:상|하)\)|미적분?|확통|기하|도형|대수/, "math"],
];
const PURITY = 0.9;
const MIN_ROWS = 10;
const MIN_NAMES = 2;
const MIN_WORD_NAMES = 3;
const AMBIGUOUS = Symbol("ambiguous");
type Group = string | typeof AMBIGUOUS | null;
type NameTable = { hangul: [string, string][]; latin: [RegExp, string][] };
type Tokens = { teacher: Map<string, string>; word: Map<string, string> };

function nameTable(subjects: readonly ProgramSubject[]): NameTable {
  const raw: [string, string][] = [];
  for (const s of subjects) {
    const g = subjectGroupOf(s.key, subjects);
    if (!g) continue;
    if (s.label.trim()) raw.push([s.label.trim().toLowerCase(), g]);
    // 내부 키('subject_1')는 이름에 안 적힌다 · 짧은 영문 키는 낱말 조각과 헷갈린다.
    if (!s.key.includes("_") && s.key.length >= 4) raw.push([s.key.toLowerCase(), g]);
  }
  if (raw.some(([, g]) => g === "english")) raw.push([ENGLISH_TRACK_LABEL.injaewon.toLowerCase(), "english"]);
  raw.sort((a, b) => b[0].length - a[0].length);
  const isLatin = (t: string) => /^[a-z0-9 ]+$/.test(t);
  const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return {
    hangul: raw.filter(([t]) => !isLatin(t)),
    // 영문은 낱말로만 — 앞뒤에 영문자가 붙으면 다른 낱말이다('Mathew' ≠ math).
    latin: raw.filter(([t]) => isLatin(t)).map(([t, g]) => [new RegExp(`(?<![a-z])${escape(t)}(?![a-z])`), g]),
  };
}

/** ②·③ — 이름 하나로 정해지는 묶음(설정 묶음 키). 두 과목이 적혔으면 `AMBIGUOUS`, 못 정하면 null. */
function explicitGroup(name: string, table: NameTable, groups: ReadonlySet<string>): Group {
  let text = name.toLowerCase();
  for (const word of NOT_SUBJECT) text = text.split(word).join(" ");
  const found = new Set<string>();
  for (const [label, g] of table.hangul) {
    if (!text.includes(label)) continue;
    found.add(g);
    text = text.split(label).join(" "); // '수학(심화)'를 읽었으면 그 안의 '수학'을 다시 읽지 않는다
  }
  for (const [re, g] of table.latin) if (re.test(text)) found.add(g);
  if (found.size > 1) return AMBIGUOUS;
  if (found.size === 1) return [...found][0]!;
  const letter = LETTER.exec(name)?.[1];
  const byLetter = letter === "E" ? "english" : letter === "M" ? "math" : null;
  if (byLetter && groups.has(byLetter)) return byLetter;
  const byWord = new Set(SUBJECT_WORDS.filter(([re, g]) => groups.has(g) && re.test(name)).map(([, g]) => g));
  return byWord.size === 1 ? [...byWord][0]! : byWord.size > 1 ? AMBIGUOUS : null;
}

const personName = (t: string) => t.length === 3 && SURNAMES.includes(t[0]!);

/** 프로그램 낱말 — 세 글자 넘는 한글 낱말 · '[머리표]'(EiE 제외). 강사 표시가 아무것도 못 가리킬 때만 쓴다. */
export function wordTokens(name: string): string[] {
  const out = new Set<string>();
  for (const m of name.matchAll(/[가-힣]{3,}/g)) out.add(m[0]);
  for (const m of name.matchAll(/\[([^\]]{1,10})\]/g)) if (m[1]!.toLowerCase() !== "eie") out.add(`[${m[1]}]`);
  return [...out];
}

/** 강사 표시(사람 이름 모양만) — 영문 별명('Brian' — 첫 글자만 대문자 · 'SKY'·'TOP' 같은 약자는 아니다) · 성으로 시작하는 세 글자 'OOO반'·'(OOO)' · 'OOOT' · '(유)'. */
export function teacherTokens(name: string): string[] {
  const out = new Set<string>();
  for (const m of name.matchAll(/(?<![A-Za-z])([A-Z][a-z]{2,})(?![a-z])/g)) out.add(m[1]!.toLowerCase());
  for (const m of name.matchAll(/([가-힣]{3})반/g)) if (personName(m[1]!)) out.add(m[1]!);
  for (const m of name.matchAll(/\(([가-힣]{3})\)/g)) if (personName(m[1]!)) out.add(m[1]!);
  for (const m of name.matchAll(/([가-힣]{2,3})T(?![A-Za-z])/g)) out.add(m[1]!);
  for (const m of name.matchAll(/\(([가-힣])\)/g)) if (!WEEKDAYS.includes(m[1]!)) out.add(`(${m[1]})`);
  return [...out];
}

/**
 * EiE 수업 줄 — 수업명이 `[EiE]`로 시작(**대소문자 무시** — 지난 기록의 EiE 칸 · 메이크에듀 집계 `ilike '[EiE]%'`와 같은 규칙 — 한 곳).
 * 🔴 청구 항목엔 `[EIE] Let's Speak 6`처럼 대문자로 적힌 EiE 반이 있다(2026년 달마다 EiE 줄의 10~20% · 2025년 28줄) — 대소문자를 가리면
 *    그 학생이 'EiE 외 수업'으로 세진다(리뷰 2026-10-21 실측).
 */
export const isEieLesson = (name: string) => /^\s*\[eie\]/i.test(name);
/** 묶음 → 프로그램 — 영어는 EiE 표시가 없으면 인재원 영어(그 밖 묶음은 키 그대로). */
const programOfGroup = (group: string): LessonProgram => (group === "english" ? "injaewon" : group);

/** 직원 정보 → 강사 표시 묶음. 같은 표시가 서로 다른 묶음의 직원에게 있으면(동명이인) 쓰지 않는다. */
function staffTokens(staff: readonly LessonStaff[], subjects: readonly ProgramSubject[]): Map<string, string> {
  const seen = new Map<string, Set<string>>();
  for (const person of staff) {
    const own = new Set(person.subjects.map((k) => subjectGroupOf(k, subjects)).filter((g): g is string => !!g));
    if (own.size !== 1) continue;
    const g = [...own][0]!;
    for (const raw of person.names) {
      const t = raw?.trim();
      if (!t) continue;
      // 영문 이름은 낱말마다('Brian Kim' → brian · kim), 한글 이름은 그대로.
      const keys = /[A-Za-z]/.test(t) ? t.split(/[^A-Za-z]+/).filter((w) => w.length >= 3).map((w) => w.toLowerCase()) : [t];
      for (const k of keys) (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(g);
    }
  }
  return new Map([...seen].filter(([, gs]) => gs.size === 1).map(([k, gs]) => [k, [...gs][0]!]));
}

/**
 * 판정기를 만든다 — `names`(그 기간에 나온 수업명과 줄 수)에서 강사 표시·프로그램 낱말의 묶음을 배운 뒤, 이름마다 프로그램(모르면 null)을 돌려준다.
 */
export function lessonProgramClassifier(
  names: readonly LessonName[],
  subjects: readonly ProgramSubject[],
  staff: readonly LessonStaff[] = [],
): (name: string) => LessonProgram | null {
  const table = nameTable(subjects);
  const groups = new Set([...table.hangul, ...table.latin].map(([, g]) => g));
  const byStaff = staffTokens(staff, subjects);
  const explicit = new Map<string, Group>();
  for (const { name } of names) explicit.set(name, isEieLesson(name) ? "english" : explicitGroup(name, table, groups));
  // 두 번 돈다 — 첫 번은 이름으로 정해진 수업명에서, 둘째 번은 첫 번에 강사 표시로 정해진 수업명까지 더해 배운다.
  let assigned = new Map<string, Group>(explicit);
  let tokens: Tokens = { teacher: new Map(), word: new Map() };
  for (let round = 0; round < 2; round++) {
    tokens = learnTokens(names, assigned, byStaff);
    const next = new Map<string, Group>(explicit);
    for (const { name } of names) if (next.get(name) === null) next.set(name, voteGroup(name, tokens));
    assigned = next;
  }
  const groupOf = (name: string): Group => {
    if (assigned.has(name)) return assigned.get(name)!;
    const e = explicitGroup(name, table, groups);
    return e === null ? voteGroup(name, tokens) : e;
  };
  return (name) => {
    if (isEieLesson(name)) return "eie";
    const g = groupOf(name);
    return typeof g === "string" ? programOfGroup(g) : null;
  };
}

type Tally = { rows: Map<string, Map<string, number>>; named: Map<string, Map<string, number>> };

/** 정해진 수업명에서 표시마다 묶음별 줄 수·수업명 수를 센다. */
function tally(names: readonly LessonName[], assigned: ReadonlyMap<string, Group>, pick: (name: string) => string[]): Tally {
  const rows = new Map<string, Map<string, number>>();
  const named = new Map<string, Map<string, number>>();
  for (const { name, weight } of names) {
    const g = assigned.get(name);
    if (typeof g !== "string") continue;
    for (const t of pick(name)) {
      const r = rows.get(t) ?? rows.set(t, new Map()).get(t)!;
      r.set(g, (r.get(g) ?? 0) + weight);
      const n = named.get(t) ?? named.set(t, new Map()).get(t)!;
      n.set(g, (n.get(g) ?? 0) + 1);
    }
  }
  return { rows, named };
}

/** 줄 수로도 수업명 수로도 순도 90% · 10줄 이상 · 서로 다른 수업명 `minNames`개 이상인 표시만. */
function pure(t: Tally, minNames: number): Map<string, string> {
  const out = new Map<string, string>();
  for (const [token, r] of t.rows) {
    const n = t.named.get(token)!;
    const rowTotal = [...r.values()].reduce((s, v) => s + v, 0);
    const nameTotal = [...n.values()].reduce((s, v) => s + v, 0);
    const [g, v] = [...r.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
    if (rowTotal >= MIN_ROWS && nameTotal >= minNames && v / rowTotal >= PURITY && (n.get(g) ?? 0) / nameTotal >= PURITY) out.set(token, g);
  }
  return out;
}

/** 표시 → 묶음을 배운다. 강사 표시는 직원 정보가 먼저다(지금 그 사람의 담당 과목 — 세 줄짜리 대타 수업이 판정을 뒤집지 않게). */
function learnTokens(names: readonly LessonName[], assigned: ReadonlyMap<string, Group>, byStaff: ReadonlyMap<string, string>): Tokens {
  const teacher = pure(tally(names, assigned, teacherTokens), MIN_NAMES);
  for (const [t, g] of byStaff) teacher.set(t, g);
  return { teacher, word: pure(tally(names, assigned, wordTokens), MIN_WORD_NAMES) };
}

/** 강사 표시가 가리키는 묶음 — 강사 표시가 아무것도 못 가리키면 프로그램 낱말로. 하나면 그 묶음, 여럿이면 null. */
function voteGroup(name: string, tokens: Tokens): string | null {
  const vote = (list: string[], map: ReadonlyMap<string, string>) => new Set(list.flatMap((t) => (map.has(t) ? [map.get(t)!] : [])));
  const byTeacher = vote(teacherTokens(name), tokens.teacher);
  const votes = byTeacher.size ? byTeacher : vote(wordTokens(name), tokens.word);
  return votes.size === 1 ? [...votes][0]! : null;
}
