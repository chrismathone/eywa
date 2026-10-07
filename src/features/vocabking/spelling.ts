/**
 * 보카킹 오답 → **실수 유형**(순수). 인재원 결과지의 틀린 문항(`prompt`·`answer`·`typed`)만으로 판정한다.
 *
 * 🔑 철자 문항 = 정답이 영어(한→영 쓰기). 뜻 문항 = 정답이 한글(영→한 뜻 고르기·쓰기).
 * 🔴 판정할 수 없는 것은 판정하지 않는다 — 반대말·유사어 혼동은 사전이 있어야 알 수 있어 여기서 만들지 않는다
 *    (원장 2026-10-07 "데이터 없음은 빼고"). 뜻 문항은 '뜻 혼동' 하나로만 센다.
 */

export type SpellingKind = "swap" | "missing" | "extra" | "oneLetter" | "several" | "blank";

export const SPELLING_LABEL: Record<SpellingKind, string> = {
  swap: "글자 순서 바뀜",
  missing: "글자 빠짐",
  extra: "글자 더 씀",
  oneLetter: "글자 하나 틀림",
  several: "여러 글자 틀림",
  blank: "답을 비움",
};

/** 긴 단어 기준(글자 수) — 이 이상이면 '긴 단어'로 따로 센다. */
export const LONG_WORD = 9;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/** 정답이 영어 단어·구인가(= 철자 문항). 한글이 하나라도 있으면 뜻 문항이다. */
export function isSpellingItem(answer: string): boolean {
  return /[a-z]/i.test(answer) && !/[가-힣]/.test(answer);
}

const dropAt = (s: string, i: number) => s.slice(0, i) + s.slice(i + 1);

export function classifySpelling(answer: string, typed: string): SpellingKind {
  const a = norm(answer);
  const t = norm(typed);
  if (!t) return "blank";
  if (a.length === t.length) {
    const diff: number[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== t[i]) diff.push(i);
    if (diff.length === 2 && diff[1] === diff[0]! + 1 && a[diff[0]!] === t[diff[1]!] && a[diff[1]!] === t[diff[0]!]) return "swap";
    if (diff.length === 1) return "oneLetter";
    return "several";
  }
  if (t.length === a.length - 1) {
    for (let i = 0; i < a.length; i++) if (dropAt(a, i) === t) return "missing";
  }
  if (t.length === a.length + 1) {
    for (let i = 0; i < t.length; i++) if (dropAt(t, i) === a) return "extra";
  }
  return "several";
}

export type WrongItem = { prompt: string; answer: string; typed: string };

export type MistakeSummary = {
  /** 철자 실수 유형별 개수(많은 순). */
  spelling: { kind: SpellingKind; label: string; count: number }[];
  spellingTotal: number;
  /** 그중 긴 단어(LONG_WORD 글자 이상). */
  longWords: number;
  /** 뜻 문항 오답 수. */
  meaning: number;
  /** 화면 예시 — 철자 오답 앞 5개(정답·쓴 답·유형). */
  spellingExamples: (WrongItem & { kind: SpellingKind })[];
  meaningExamples: WrongItem[];
};

export function summarizeMistakes(wrong: readonly WrongItem[]): MistakeSummary {
  const counts = new Map<SpellingKind, number>();
  const spellingExamples: (WrongItem & { kind: SpellingKind })[] = [];
  const meaningExamples: WrongItem[] = [];
  let longWords = 0;
  let meaning = 0;
  for (const w of wrong) {
    if (!isSpellingItem(w.answer)) {
      meaning += 1;
      meaningExamples.push(w);
      continue;
    }
    const kind = classifySpelling(w.answer, w.typed);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (norm(w.answer).replace(/[^a-z]/g, "").length >= LONG_WORD) longWords += 1;
    spellingExamples.push({ ...w, kind });
  }
  const spelling = [...counts.entries()]
    .map(([kind, count]) => ({ kind, label: SPELLING_LABEL[kind], count }))
    .sort((x, y) => y.count - x.count);
  return {
    spelling,
    spellingTotal: spellingExamples.length,
    longWords,
    meaning,
    spellingExamples: spellingExamples.slice(0, 5),
    meaningExamples: meaningExamples.slice(0, 5),
  };
}
