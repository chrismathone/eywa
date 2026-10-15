/**
 * 학부모 만족도 — 학부모 글·댓글 한 건의 **문구 판정**(계획서 3번 · 원장 결정 8 *"확실한 것은 즉시, 애매한 것은 확인 후"*). 순수 함수.
 *
 * - 무시 문구('감사합니다'·'수고하세요' 같은 인사)를 먼저 지운 뒤 가점·감점 문구를 찾는다("오늘 결석합니다. 감사합니다."에 가점이 붙지 않게
 *   — 출결 연락으로 분류된 글은 애초에 판정하지 않는다).
 * - 확실 = 가점 문구만 · 감점 문구만(완곡어 없이) → 바로 반영. 애매 = 가점·감점이 함께 · 감점에 완곡어 · 문구 없이 긴 글 → 확인 대기
 *   (학원 설정에서 AI를 켜면 AI가 먼저 읽고, 그 판정도 사람이 확인한 뒤 반영한다). 짧고 문구가 없으면 판정 없음.
 * - 한 글은 한 번만 — 여러 문구가 걸리면 가장 센 문구 하나로(점수를 문구 수만큼 더하지 않는다).
 */
import type { SatisfactionOptions } from "../evaluation/options";

export type RuleVerdict =
  | { kind: "plus" | "minus"; phrase: string }
  | { kind: "ambiguous"; reason: string; phrase: string | null }
  | { kind: "none" };

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const bare = (s: string) => s.replace(/\s+/g, "");
/** 띄어쓰기를 무시하고 찾는다("그만 두려고" = "그만두려고"). */
const has = (text: string, phrase: string) => phrase.trim() !== "" && bare(text).includes(bare(phrase));

export function judgeByRules(content: string, o: SatisfactionOptions): RuleVerdict {
  let text = squash(content);
  for (const phrase of o.ignore) if (phrase.trim()) text = bare(text).split(bare(phrase)).join(" ");
  const plus = o.positive.filter((p) => has(text, p.phrase)).sort((a, b) => b.points - a.points);
  const minus = o.negative.filter((p) => has(text, p.phrase)).sort((a, b) => a.points - b.points);
  if (plus.length && minus.length) return { kind: "ambiguous", reason: "가점·감점 문구가 함께 있음", phrase: minus[0]!.phrase };
  if (minus.length) {
    const hedge = o.hedges.find((h) => has(text, h));
    return hedge ? { kind: "ambiguous", reason: `감점 문구에 완곡어('${hedge}')`, phrase: minus[0]!.phrase } : { kind: "minus", phrase: minus[0]!.phrase };
  }
  if (plus.length) return { kind: "plus", phrase: plus[0]!.phrase };
  return bare(text).length >= o.longChars ? { kind: "ambiguous", reason: "문구 없이 긴 글", phrase: null } : { kind: "none" };
}

/** 판정 한 건의 점수 — 그 달 설정에서 근거 문구의 점수, 문구가 없거나 목록에서 빠졌으면(AI·사람 판정) 가점·감점 기본 점수. */
export function verdictPoints(verdict: "plus" | "minus", phrase: string | null, o: SatisfactionOptions): number {
  const list = verdict === "plus" ? o.positive : o.negative;
  const hit = phrase ? list.find((p) => bare(p.phrase) === bare(phrase)) : undefined;
  return hit ? hit.points : verdict === "plus" ? o.plusPoints : o.minusPoints;
}
