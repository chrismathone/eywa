import { getAnthropic } from "./anthropic";
import { getUpstage } from "./upstage";
import { resolveModel, type AiKeyName, type AiProvider, type AiTier } from "./models";

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

export async function generateJSON<T>(opts: GenerateJSONOptions): Promise<{ data: T; model: string }> {
  const tier = opts.tier ?? "balanced";
  const keyName = opts.keyName ?? "default";
  const { provider, model } = resolveModel(tier, keyName, opts.provider);

  let text = "";
  if (provider === "upstage") {
    const client = getUpstage(keyName);
    try {
      const res = await client.chat.completions.create({
        model,
        max_tokens: opts.maxTokens,
        // JSON mode — 프롬프트에 "JSON" 단어가 있어야 함(현 호출부 전부 "JSON만 출력" 포함).
        response_format: { type: "json_object" },
        messages: [
          ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
          { role: "user" as const, content: opts.prompt },
        ],
      });
      text = res.choices[0]?.message?.content ?? "";
    } catch (e) {
      rethrowAi("upstage", e);
    }
  } else {
    const client = getAnthropic(keyName);
    try {
      const res = await client.messages.create({
        model,
        max_tokens: opts.maxTokens,
        ...(opts.system ? { system: opts.system } : {}),
        messages: [{ role: "user", content: opts.prompt }],
      });
      text = res.content[0]?.type === "text" ? res.content[0].text : "";
    } catch (e) {
      rethrowAi("anthropic", e);
    }
  }

  return { data: parseJsonLoose<T>(text), model };
}
