/**
 * 판정 원문 → 화면 결과(ReviewResult) 정리 — 순수 함수. 하네스의 '코드 몫' 전부가 여기 있다:
 * 검산 근거 없는 실수 제거 · 확인 단계 판정 반영 · 감점 근거 없는 정확성 보정 · 종합 판정 계산 · 메모 후처리.
 */
import { SCORE_KEYS, type ReviewOverall, type ReviewResult, type ScoreKey } from "../types";
import type { MistakeClaim, VerifyVerdict } from "./prompt-verify";
import type { SpeechStats } from "./transcript";

type JudgeRaw = {
  topic?: unknown;
  scores?: Partial<Record<ScoreKey, { score?: unknown; evidence?: unknown }>>;
  checks?: { no?: unknown; result?: unknown }[];
  mistakes?: unknown[];
  unclear?: unknown[];
  transcript_fixes?: { at?: unknown; heard?: unknown; fixed?: unknown; by?: unknown }[];
  teacher_note?: unknown;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const score = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null);

/** 검산(checks)에서 '틀림'으로 나온 실수만 남긴다 — 검산표가 비어 있으면 위치가 있는 주장을 그대로 둔다. */
export function claimsFrom(judge: JudgeRaw): MistakeClaim[] {
  const wrong = new Set((judge.checks ?? []).filter((c) => c?.result === "틀림").map((c) => Number(c?.no)));
  const hasChecks = (judge.checks ?? []).length > 0;
  return (judge.mistakes ?? [])
    .filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null)
    .map((m) => ({ where: str(m.where), seen: str(m.seen), why_wrong: str(m.why_wrong), check: Number(m.check), certainty: str(m.certainty) }))
    .filter((m) => m.where && m.why_wrong && (!hasChecks || wrong.has(m.check)));
}

/**
 * 확인(반박) 단계로 보내는 주장 수 상한 — 주장마다 화면 13장이 함께 가서 배치 요청이 커진다(상한 256MB).
 * 넘는 주장은 확인 없이 '선생님 확인 필요'로 남는다(buildResult가 판정 없는 주장을 '애매'로 둔다).
 */
export const MAX_VERIFY_CLAIMS = 4;
export function verifyTargets<T>(claims: readonly T[]): T[] {
  return claims.slice(0, MAX_VERIFY_CLAIMS);
}

/** 종합 판정 — 모델이 아니라 코드가 점수로 정한다(하네스 2차~). */
export function overallOf(s: Record<ScoreKey, number | null>): ReviewOverall {
  const v = SCORE_KEYS.map((k) => s[k]).filter((x): x is number => typeof x === "number");
  const avg = v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
  if ((s.accuracy ?? 5) <= 2 || avg < 2.8) return "needs_work";
  if ((s.accuracy ?? 0) >= 4 && (s.reasoning ?? 0) >= 3 && avg >= 4) return "good";
  return "fair";
}

/** 메모 후처리 — 말하기 자료·판독 결과와 부딪치는 표현을 고친다(메모 위반 0의 구조적 보장, 하네스 5차). */
export function fixNote(note: string, speech: Pick<SpeechStats, "pauses" | "fillers">, hasUnclear: boolean): string {
  let n = note;
  if (speech.pauses.length) n = n.replace(/(막힘|끊김|멈춤)\s*없이/g, "끝까지").replace(/막힘없이|끊김없이/g, "끝까지");
  if (Object.keys(speech.fillers).length) n = n.replace(/군말\s*없이/g, "군말이 적게");
  if (hasUnclear) {
    n = n
      .replace(/모두\s*맞(게|았|고|으며|다)/g, "확인한 범위에서 맞$1")
      .replace(/전부\s*(정확|맞)/g, "확인한 범위에서 $1")
      .replace(/모두\s*정확/g, "확인한 범위에서 정확");
  }
  return n;
}

export type BuildInput = {
  judge: JudgeRaw;
  /** 주장마다 확인 판정(claimsFrom 순서). 확인을 안 거쳤으면 null — 그때 주장은 모두 '확인 필요'로 간다. */
  verdicts: VerifyVerdict[] | null;
  speech: Pick<SpeechStats, "pauses" | "fillers">;
  judgeModel: string | null;
  verifyModel: string | null;
  now: Date;
};

export function buildResult(input: BuildInput): ReviewResult {
  const claims = claimsFrom(input.judge);
  const mistakes: ReviewResult["mistakes"] = [];
  const needsCheck: string[] = [];
  const selfFixed: string[] = [];
  claims.forEach((c, i) => {
    const v = input.verdicts?.[i] ?? "애매";
    const text = `${c.where} — ${c.why_wrong}`;
    if (v === "확정") mistakes.push({ where: c.where, seen: c.seen, whyWrong: c.why_wrong });
    else if (v === "고침") selfFixed.push(text);
    else if (v === "애매") needsCheck.push(text);
  });
  const unclear = (input.judge.unclear ?? []).map(str).filter(Boolean);
  needsCheck.push(...unclear);
  const raw = Object.fromEntries(SCORE_KEYS.map((k) => [k, score(input.judge.scores?.[k]?.score)])) as Record<ScoreKey, number | null>;
  // 감점했는데 확정 오류가 없으면 4로(근거 없는 감점 금지 — 하네스 2차 규칙의 코드 보장).
  if (raw.accuracy != null && raw.accuracy <= 3 && mistakes.length === 0) raw.accuracy = 4;
  const scores = Object.fromEntries(
    SCORE_KEYS.map((k) => [k, { score: raw[k], evidence: str(input.judge.scores?.[k]?.evidence) }]),
  ) as ReviewResult["scores"];
  return {
    overall: overallOf(raw),
    topic: str(input.judge.topic),
    scores,
    mistakes,
    needsCheck,
    selfFixed,
    note: fixNote(str(input.judge.teacher_note), input.speech, unclear.length > 0 || needsCheck.length > 0),
    transcriptFixes: (input.judge.transcript_fixes ?? [])
      .map((f) => ({ at: str(f?.at), heard: str(f?.heard), fixed: str(f?.fixed), by: str(f?.by) }))
      .filter((f) => f.heard && f.fixed),
    analyzedAt: input.now.toISOString(),
    judgeModel: input.judgeModel,
    verifyModel: input.verifyModel,
  };
}
