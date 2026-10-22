/**
 * 교재 순서 — 한 시리즈의 권을 학년·학기·권 순으로 한 줄로 편다(원장 2026-10-20 *"중1-1 1-2 2-1 2-2 3-1 고 1-1
 * 이런식으로 … 가우스 중2-2 4권 시작이면 바로 중3-1 교재로 자동으로 계속 넘어가게"*).
 *
 * 🔑 학기마다 권 번호는 **교재목록이 있으면 교재목록의 권**, 없으면 가우스 관례(1학기 1·2권 · 2학기 3·4권).
 * 🔑 교재목록에 아직 없는 권도 순서에는 선다 — 차시는 `ASSUMED_LESSONS`로 가정하고 `listed: false`로 표시한다
 *    (목표 계산이 교재 등록을 기다리지 않게. 화면은 '교재목록 미등록'이라 적는다).
 * 🔴 교재목록 열쇠(`catalogBookKey`) 하나로 맞춘다 — 제목 글자로 비교하지 않는다(표기 흔들림, math-book-match.ts).
 */
import { bookKey, type CatalogBook } from "./math-book-match";

export const ASSUMED_LESSONS = 8;

export type SeqBook = {
  key: string;
  title: string;
  /** `중2-2` */
  term: string;
  volume: number;
  catalog: CatalogBook | null;
  /** 차시별 소단원 이름들(교재목록 차시표). 미등록이면 빈 배열. */
  lessonUnits: string[][];
  lessonCount: number;
};

const LEVELS = ["초", "중", "고"] as const;

export function parseKey(key: string): { series: string; level: string; grade: number; sem: number; volume: number } | null {
  const m = key.match(/^(.+)\|([초중고])(\d)-(\d)\|(\d+)$/);
  return m ? { series: m[1]!, level: m[2]!, grade: Number(m[3]), sem: Number(m[4]), volume: Number(m[5]) } : null;
}
export const seriesOfKey = (key: string) => parseKey(key)?.series ?? null;

function nextTerm(level: string, grade: number, sem: number): { level: string; grade: number; sem: number } | null {
  if (sem === 1) return { level, grade, sem: 2 };
  const top = level === "초" ? 6 : 3;
  if (grade < top) return { level, grade: grade + 1, sem: 1 };
  const i = LEVELS.indexOf(level as (typeof LEVELS)[number]);
  return i >= 0 && i < LEVELS.length - 1 ? { level: LEVELS[i + 1]!, grade: 1, sem: 1 } : null;
}

const unitsOf = (book: CatalogBook) =>
  [...book.lessons].sort((a, b) => a.lessonNo - b.lessonNo)
    .map((l) => (l.progress ?? "").split(" / ").map((u) => u.replace(/^[\d-]+\.\s*/, "").trim()).filter(Boolean));

/** `from` 열쇠부터 `max`권까지의 순서. 열쇠를 못 읽으면 빈 배열. */
export function bookSequence(fromKey: string, catalog: readonly CatalogBook[], max = 40): SeqBook[] {
  const start = parseKey(fromKey);
  if (!start) return [];
  const byKey = new Map<string, CatalogBook>();
  for (const b of catalog) {
    const k = bookKey(b);
    if (k && seriesOfKey(k) === start.series && !byKey.has(k)) byKey.set(k, b);
  }
  const levels = new Set([...byKey.keys()].map((k) => parseKey(k)?.level));
  const hasMiddle = levels.has("중");
  const hasHigh = levels.has("고");
  const out: SeqBook[] = [];
  let term: { level: string; grade: number; sem: number } | null = start;
  while (term && out.length < max) {
    const name = `${term.level}${term.grade}-${term.sem}`;
    const prefix = `${start.series}|${name}|`;
    const listed = [...byKey.keys()].filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)));
    // 교재목록 권 ∪ 관례 권 — 한 권만 등록돼 있어도 등록 안 된 다른 권이 순서에서 빠지지 않게.
    // ⚠️ 관례(1학기 1·2권 · 2학기 3·4권)는 **중등 가우스**의 것이다(원장 2026-10-22 학년·학기 도입 때 좁힘):
    //    · 중등 교재가 하나도 없는 시리즈(초등 `발전`)엔 얹지 않는다 — 없는 `발전 중1-1 1권`이 선다.
    //    · 고등은 그 시리즈에 **실제 고등 교재가 있으면** 교재목록 권만(단원 묶음 권이라 관례가 안 맞는다).
    //      없으면 종전처럼 자리표시 권을 세운다(마감이 먼 학생의 목표가 중3에서 끊기지 않게).
    const convention = term.level === "중" && hasMiddle ? (term.sem === 1 ? [1, 2] : [3, 4])
      : term.level === "고" && hasMiddle && !hasHigh ? (term.sem === 1 ? [1, 2] : [3, 4])
      : [];
    const volumes = [...new Set([...listed, ...convention])].sort((a, b) => a - b);
    for (const volume of volumes) {
      if (out.length === 0 && volume < start.volume) continue;
      if (out.length >= max) break;
      const key = `${prefix}${volume}`;
      const cat = byKey.get(key) ?? null;
      const lessonUnits = cat ? unitsOf(cat) : [];
      out.push({
        key, term: name, volume, catalog: cat, lessonUnits,
        title: cat?.title ?? `${start.series} ${name} ${volume}권`,
        lessonCount: cat && cat.lessons.length > 0 ? cat.lessons.length : ASSUMED_LESSONS,
      });
    }
    term = nextTerm(term.level, term.grade, term.sem);
  }
  return out;
}

/** 순서 비교용 서수 — 같은 시리즈 안에서만 의미가 있다. */
export function keyOrdinal(key: string): number {
  const p = parseKey(key);
  if (!p) return -1;
  return ((LEVELS.indexOf(p.level as (typeof LEVELS)[number]) * 10 + p.grade) * 10 + p.sem) * 100 + p.volume;
}
