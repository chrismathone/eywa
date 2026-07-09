import { getAnthropic } from "./anthropic";
import { getUpstage } from "./upstage";
import { resolveModel, resolveModelChain, type AiKeyName, type AiProvider, type AiTier } from "./models";
import { reportWarning } from "@/lib/observability/report-error";

/**
 * ```json 펜스 제거 + 첫 {…} 객체 추출 + JSON.parse. 5개 AI 호출지점에 흩어져 있던 파싱 로직을
 * 한 곳으로 통합. 순수함수(Vitest 단위테스트). JSON mode(Upstage)·평문(Anthropic)·마크다운 펜스·
 * 앞뒤 잡설 섞인 응답 모두 견딘다.
 */
export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text
    .replace(/^\s*```json\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 응답에서 JSON을 찾을 수 없습니다");
    return JSON.parse(match[0]) as T;
  }
}

export type GenerateJSONOptions = {
  /** 한 개의 user 메시지로 보낼 프롬프트(현 호출부는 전부 단일 user 메시지). */
  prompt: string;
  /** 선택적 system 지침(없으면 미전송). */
  system?: string;
  maxTokens: number;
  /** 기본 balanced(현 모든 호출). reasoning은 Anthropic 고정. */
  tier?: AiTier;
  /** 빌링 버킷. 기본 default(등록상담+회의록), 학생 케어는 "consultations". */
  keyName?: AiKeyName;
  /**
   * provider 선호(강제 아님 — 키 없으면 평소 폴백). 녹음 분석은 구조화 추출 품질을 위해
   * `"anthropic"`(Claude)을 우선한다. 미설정 시 tier/AI_PROVIDER 기본(보통 Upstage Solar).
   */
  provider?: AiProvider;
  /** 생성 temperature(0~1). 미설정 시 provider 기본. 멘트=0.3(사실 서술 일관성, edutrix Solar 후보정 이식). */
  temperature?: number;
  /**
   * Upstage(Solar) reasoning_effort. 멘트="minimal" — 안 하면 추론 과정이 본문에 섞임(edutrix 후보정).
   * Anthropic엔 무시(extended thinking 미사용). 도메인별 opt-in(전역 기본 미변경).
   */
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
};

/**
 * 모든 AI(JSON) 호출의 단일 진입점. `resolveModel`로 provider(기본 Solar Pro 3, env로 Claude 롤백)를
 * 고르고 → Upstage(OpenAI 호환, JSON mode) 또는 Anthropic을 호출 → 응답 텍스트를 `parseJsonLoose<T>`.
 * 실패 시 throw — 호출부의 기존 stub/error 폴백을 그대로 유지한다.
 *
 * @returns `data`(파싱된 T) + `model`(실제 사용 모델 id — model_version 문자열 재료).
 */
/**
 * provider 호출 에러를 분류 — 인증/키 오류(401·403)는 관리자가 알아볼 수 있는 한글 메시지로 바꿔
 * 다시 throw한다. 그래야 processing_error에 영문 원문 대신 "키를 고쳐라"가 떠 관리자가 조치할 수 있다.
 * (silent provider 폴백은 의도적으로 안 함 — 키가 무효면 표면에 드러나야 한다.)
 */
function rethrowAi(provider: "upstage" | "anthropic", err: unknown): never {
  const label = provider === "upstage" ? "Upstage(Solar)" : "Anthropic(Claude)";
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403 || /invalid.*api key|unauthorized|api key/i.test(raw)) {
    throw new Error(
      `AI 키 오류: ${label} API 키가 유효하지 않습니다(${status ?? "인증 거부"}). 관리자가 환경변수의 AI API 키를 확인·갱신해야 합니다.`,
    );
  }
  if (status === 429) {
    throw new Error(`AI 사용량 한도 초과: ${label} 요청이 일시적으로 제한되었습니다(429). 잠시 후 다시 시도하세요.`);
  }
  throw err instanceof Error ? err : new Error(raw);
}

/** provider 호출 에러의 HTTP 상태코드(SDK가 status를 안 주면 undefined). */
function providerErrorStatus(err: unknown): number | undefined {
  return typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status?: unknown }).status)
    : undefined;
}

/** 다른 provider로 폴백할 가치가 있는 오류인가 — 인증(401/403)·한도(429), 또는 키 무효 메시지. */
export function isRetryableProviderError(err: unknown): boolean {
  const status = providerErrorStatus(err);
  if (status === 401 || status === 403 || status === 429) return true;
  const raw = err instanceof Error ? err.message : String(err);
  return /invalid.*api key|unauthorized|api key/i.test(raw);
}

/** provider별 1회 호출 — 응답 텍스트만 반환(throw는 generateJSON 루프가 처리). */
async function callProvider(
  provider: AiProvider,
  model: string,
  keyName: AiKeyName,
  opts: GenerateJSONOptions,
): Promise<string> {
  if (provider === "upstage") {
    const client = getUpstage(keyName);
    // 변수(리터럴 아님)로 만들어 reasoning_effort(Upstage 확장 파라미터, 표준 타입 밖)를 부착 —
    // 리터럴 직접 전달 시 excess-property 검사에 걸리므로 base 변수로 우회. non-stream 오버로드(res.choices) 유지.
    const base = {
      model,
      max_tokens: opts.maxTokens,
      // JSON mode — 프롬프트에 "JSON" 단어가 있어야 함(현 호출부 전부 "JSON만 출력" 포함).
      response_format: { type: "json_object" as const },
      ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      ...(opts.reasoningEffort ? { reasoning_effort: opts.reasoningEffort } : {}),
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: opts.prompt },
      ],
    };
    const res = await client.chat.completions.create(base);
    return res.choices[0]?.message?.content ?? "";
  }
  const client = getAnthropic(keyName);
  const res = await client.messages.create({
    model,
    max_tokens: opts.maxTokens,
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.system ? { system: opts.system } : {}),
    messages: [{ role: "user", content: opts.prompt }],
  });
  return res.content[0]?.type === "text" ? res.content[0].text : "";
}

export async function generateJSON<T>(opts: GenerateJSONOptions): Promise<{ data: T; model: string }> {
  const tier = opts.tier ?? "balanced";
  const keyName = opts.keyName ?? "default";
  const chain = resolveModelChain(tier, keyName, opts.provider);
  // 키가 하나도 없으면 기존 동작 보존: 모델 있는 첫 candidate로 시도(클라 생성 시 키 없음 throw → rethrowAi).
  const candidates = chain.length > 0 ? chain : [resolveModel(tier, keyName, opts.provider)];

  let lastErr: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const { provider, model } = candidates[i];
    try {
      const text = await callProvider(provider, model, keyName, opts);
      return { data: parseJsonLoose<T>(text), model };
    } catch (e) {
      lastErr = e;
      // 인증/한도 오류 + 다음 후보가 있으면 다른 provider로 폴백(B1: 무효·만료 키도 자동 회복).
      // 그 외(파싱·400·5xx) 또는 마지막 후보면 즉시 한글화해 표면화.
      if (i < candidates.length - 1 && isRetryableProviderError(e)) {
        reportWarning(`AI ${provider} 호출 실패 → 다른 provider로 폴백`, {
          scope: "generateJSON.fallback",
          provider,
          model,
          status: providerErrorStatus(e),
        });
        continue;
      }
      rethrowAi(provider, e);
    }
  }
  // 도달 불가(루프가 항상 return 또는 throw) — 타입 종결용 terminator.
  rethrowAi(candidates[candidates.length - 1].provider, lastErr);
}
