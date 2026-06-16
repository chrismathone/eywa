import { getAnthropic } from "./anthropic";
import { getUpstage } from "./upstage";
import { resolveModel, type AiKeyName, type AiTier } from "./models";

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
};

/**
 * 모든 AI(JSON) 호출의 단일 진입점. `resolveModel`로 provider(기본 Solar Pro 3, env로 Claude 롤백)를
 * 고르고 → Upstage(OpenAI 호환, JSON mode) 또는 Anthropic을 호출 → 응답 텍스트를 `parseJsonLoose<T>`.
 * 실패 시 throw — 호출부의 기존 stub/error 폴백을 그대로 유지한다.
 *
 * @returns `data`(파싱된 T) + `model`(실제 사용 모델 id — model_version 문자열 재료).
 */
export async function generateJSON<T>(opts: GenerateJSONOptions): Promise<{ data: T; model: string }> {
  const tier = opts.tier ?? "balanced";
  const keyName = opts.keyName ?? "default";
  const { provider, model } = resolveModel(tier, keyName);

  let text = "";
  if (provider === "upstage") {
    const client = getUpstage(keyName);
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
  } else {
    const client = getAnthropic(keyName);
    const res = await client.messages.create({
      model,
      max_tokens: opts.maxTokens,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: "user", content: opts.prompt }],
    });
    text = res.content[0]?.type === "text" ? res.content[0].text : "";
  }

  return { data: parseJsonLoose<T>(text), model };
}
