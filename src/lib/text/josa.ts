/**
 * 조사(이/가 · 은/는 · 을/를 …)를 **앞 글자의 받침에 맞춰** 고르는 순수 함수.
 *
 * 🔴 왜 필요한가(2026-07-31 원장 제보): 교재요청 학부모 공지가 `{학생}이 … 신청합니다` 템플릿이라
 * **누구든 무조건 "이"로** 나갔다 — "김지우이 가우스 … 신청합니다". 받침이 없으면 "가"여야 한다.
 * 학부모가 받는 글이라 이런 어색함이 그대로 학원 인상이 된다.
 *
 * ⚠️ **동명이인 접미 알파벳도 그대로 읽는다**(원장 지시: A는 표시에 남긴다) — `김태희A`는 마지막 글자가
 *    한글이 아니라 `A`다. 알파벳은 **한국어 읽기 기준**으로 받침을 판정한다(A=에이 → 받침 없음 → "가",
 *    L=엘 → 받침 있음 → "이"). 안 그러면 `김태희A이`가 나온다.
 */

/** 한국어로 읽었을 때 받침으로 끝나는 알파벳 — L(엘)·M(엠)·N(엔)·R(알). 나머지는 모음/무받침으로 끝난다. */
const LATIN_WITH_BATCHIM = new Set(["L", "M", "N", "R"]);
/** 한국어 수 읽기 기준 받침 — 0(영)·1(일)·3(삼)·6(육)·7(칠)·8(팔). */
const DIGIT_WITH_BATCHIM = new Set(["0", "1", "3", "6", "7", "8"]);

/**
 * 마지막 글자에 받침이 있는가. 판정할 수 없으면 `null`(호출부가 원문을 그대로 두게 — 틀린 조사를 새로
 * 만드느니 손대지 않는 편이 낫다).
 */
export function hasBatchim(word: string | null | undefined): boolean | null {
  const w = (word ?? "").trim();
  if (!w) return null;
  const ch = w[w.length - 1]!;
  const code = ch.codePointAt(0)!;
  // 한글 음절(가–힣): (코드 − 가) % 28 이 0이면 종성 없음.
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
  if (/[A-Za-z]/.test(ch)) return LATIN_WITH_BATCHIM.has(ch.toUpperCase());
  if (/[0-9]/.test(ch)) return DIGIT_WITH_BATCHIM.has(ch);
  return null; // 기호·한자·이모지 등 — 읽는 법을 모른다.
}

/** 받침 있음 → 앞말, 없음 → 뒷말. `으로/로`는 ㄹ 받침이 예외라 따로 다룬다. */
const PAIRS: readonly (readonly [string, string])[] = [
  ["이랑", "랑"],
  ["으로", "로"],
  ["이", "가"],
  ["은", "는"],
  ["을", "를"],
  ["과", "와"],
];

/** ㄹ 받침(종성 8)인가 — `으로/로` 판정용(서울로 · 학교로 · **연필로**). */
function endsWithRieul(word: string): boolean {
  const ch = word.trim().slice(-1);
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return /[LlRr]/.test(ch); // 엘·알
  return (code - 0xac00) % 28 === 8;
}

/**
 * `word` 뒤에 붙일 조사를 고른다. `josa`는 짝 중 **어느 쪽을 적었든** 상관없다(`이`든 `가`든 같은 짝).
 * 받침을 판정할 수 없으면 적은 그대로 돌려준다.
 */
export function pickJosa(word: string | null | undefined, josa: string): string {
  const pair = PAIRS.find(([a, b]) => a === josa || b === josa);
  if (!pair) return josa;
  const batchim = hasBatchim(word);
  if (batchim === null) return josa;
  const [withB, withoutB] = pair;
  // 으로/로 — ㄹ 받침은 받침이 있어도 "로"를 쓴다(연필로 ○ / 연필으로 ×).
  if (withB === "으로") return batchim && !endsWithRieul(String(word)) ? "으로" : "로";
  return batchim ? withB : withoutB;
}

/** `pickJosa`가 다루는 조사 — 호출부가 정규식을 만들 때 쓴다(긴 것부터: `이랑`이 `이`보다 먼저). */
export const JOSA_ALTERNATION = PAIRS.flatMap(([a, b]) => [a, b])
  .sort((x, y) => y.length - x.length)
  .join("|");
