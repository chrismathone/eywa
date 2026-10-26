/**
 * 같은 사실이면 늘 같은 문장이 나가던 문제 — **문장 갈래(variant) 고르기**. 순수 모듈(Vitest).
 *
 * 원장 2026-10-26 *"매번 너무 동일하고 똑같은 멘트가 나가지 않도록 직전에 쓴 표현이라면 조금 다른표현 등 사용으로 너무 매크로성 동일한
 * 답변이 안되게"*. 테스트 한마디·숙제 완성도·진도 마무리 같은 코드 문장은 갈래를 여러 개 두고 여기서 하나를 고른다.
 *
 * 🔑 고르기는 **결정적**이다(같은 학생·같은 날·같은 문장 갈래 = 같은 결과) — 자동작성을 다시 눌러도 문장이 흔들리지 않는다.
 * 🔑 직전 보고서 글(`prev`)에 이미 쓴 갈래면 다음 갈래로 넘긴다 — 이틀 연속 같은 문장이 나가지 않는다.
 * ⚠️ 사실 서명(`pilotFactsSig`)은 문장이 아니라 **값**으로 만든다 — 갈래가 바뀌어도 '자동작성 다시 필요'가 뜨지 않는다.
 */

/** 갈래를 고를 재료 — 시드(학생·보고서 날짜) + 직전 보고서 글. 없으면 늘 첫 갈래(종전 문장). */
export type Variety = { seed: string; prev?: string | null };

/**
 * 받은 값이 정말 Variety인가 — 문장 함수가 `.map(fn)`으로 불리면 세 번째 인자에 배열이 들어온다(homeworkSentence 주석). 아니면 null(첫 갈래).
 */
export function asVariety(x: unknown): Variety | null {
  return x && typeof x === "object" && !Array.isArray(x) && typeof (x as Variety).seed === "string" ? (x as Variety) : null;
}

/** 작은 문자열 해시(FNV-1a 32bit) — 결정적이면 충분하다. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 갈래 하나 고르기. `family`는 문장 갈래 이름(같은 시드라도 갈래마다 다르게 돌게).
 * variety가 없으면 첫 갈래 — 화면 미리보기·옛 호출부는 종전 문장 그대로다.
 */
export function pickVariant(list: readonly string[], variety: Variety | null | undefined, family: string): string {
  if (!list.length) return "";
  if (!variety) return list[0]!;
  const start = hash(`${variety.seed}|${family}`) % list.length;
  const prev = variety.prev ?? "";
  for (let i = 0; i < list.length; i++) {
    const cand = list[(start + i) % list.length]!;
    if (!prev || !prev.includes(cand)) return cand;
  }
  return list[start]!;
}
