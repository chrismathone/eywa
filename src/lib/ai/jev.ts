/** TypeSafe transport. Application callers must use generateJSON({ mode: "decision" }). */
export const JEV_MODEL = "jev-1.13.0";
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type DecisionQuestions = Record<string, ChoiceQuestion>;
export type ChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type DecisionUsage = { inputTokens: number | null; outputTokens: number | null };
export type DecisionResult = {
  data: Record<string, ChoiceAnswer>;
  model: string;
  usage: DecisionUsage;
  elapsedMs: number;
};

export class JevError extends Error {
  constructor(message: string, readonly usage?: DecisionUsage) { super(message); }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
function tokens(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Missing/invalid answers are errors, never silently converted to `none`. */
export function parseJevResponse(raw: unknown, questions: DecisionQuestions): Omit<DecisionResult, "elapsedMs"> {
  const usage = object(raw) && object(raw.usage)
    ? { inputTokens: tokens(raw.usage.input_tokens), outputTokens: tokens(raw.usage.output_tokens) }
    : { inputTokens: null, outputTokens: null };
  const invalid = () => new JevError("Jev 응답 형식이 올바르지 않습니다", usage);
  if (!object(raw) || raw.model !== JEV_MODEL || !object(raw.answers)) throw invalid();
  const data: Record<string, ChoiceAnswer> = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw.answers[id];
    if (!object(answer) || answer.type !== "choice" || typeof answer.choice !== "string"
      || !Object.hasOwn(question.criteria, answer.choice) || !probability(answer.confidence)
      || !object(answer.probabilities)) throw invalid();
    const labels = Object.keys(question.criteria);
    const probabilities: Record<string, number> = {};
    if (Object.keys(answer.probabilities).length !== labels.length) throw invalid();
    for (const label of labels) {
      const p = answer.probabilities[label];
      if (!probability(p)) throw invalid();
      probabilities[label] = p;
    }
    // Provider rounds distributions; allow a small rounding error, not missing mass.
    if (Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) > 0.02
      || probabilities[answer.choice] < Math.max(...Object.values(probabilities))) throw invalid();
    data[id] = { type: "choice", choice: answer.choice, confidence: answer.confidence, probabilities };
  }
  return { data, model: raw.model, usage };
}

/** Bounded single attempt. The caller decides when to retry; no generative-provider fallback. */
export async function callJev(options: {
  state: unknown;
  questions: DecisionQuestions;
  apiKey: string;
  timeoutMs?: number;
}): Promise<DecisionResult> {
  if (typeof window !== "undefined") throw new JevError("Jev는 서버에서만 호출할 수 있습니다");
  const entries = Object.entries(options.questions);
  if (!entries.length || entries.length > 12 || entries.some(([, q]) => q.type !== "choice"
    || !q.instructions.trim() || Object.keys(q.criteria).length < 2 || Object.keys(q.criteria).length > 255)) {
    throw new JevError("Jev 질문 구성이 올바르지 않습니다");
  }
  const body = JSON.stringify({ model: JEV_MODEL, state: options.state, questions: options.questions });
  if (Buffer.byteLength(body, "utf8") > 120_000) throw new JevError("Jev 입력이 너무 큽니다");
  const timeoutMs = options.timeoutMs ?? 6_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new JevError("Jev 제한 시간이 올바르지 않습니다");
  if (!options.apiKey.trim()) throw new JevError("TypeSafe API 키가 없습니다");
  const start = performance.now();
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST", cache: "no-store", redirect: "error", signal,
      headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
      body,
    });
    // Never put provider error bodies (which may echo input/credentials) in logs.
    if (!response.ok) throw new JevError(`Jev HTTP ${response.status}`);
    const parsed = parseJevResponse(await response.json(), options.questions);
    return { ...parsed, elapsedMs: Math.round(performance.now() - start) };
  } catch (error) {
    if (error instanceof JevError) throw error;
    throw new JevError(signal.aborted ? "Jev 응답 시간 초과" : "Jev 연결 또는 응답 해석 실패");
  }
}
