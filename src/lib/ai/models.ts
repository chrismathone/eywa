// LLM provider/model 레지스트리 + provider 해석. **순수**(process.env만, SDK import 없음)라
// 단위테스트가 빠르다. 티어→모델 + provider별 키 env명의 단일 소스.
//
// UI엔 모델 이름을 노출하지 않는다(CLAUDE.md 정책) — 여기 문자열은 내부 식별·model_version 저장용.

export type AiProvider = "anthropic" | "upstage";
export type AiTier = "fast" | "balanced" | "reasoning";
export type AiKeyName = "default" | "consultations";

// 티어 → provider별 모델 id. reasoning은 Anthropic 전용(평소 금지 정책 + Solar reasoning 미사용).
export const AI_MODELS: Record<AiTier, Record<AiProvider, string | null>> = {
  fast: { anthropic: "claude-haiku-4-5", upstage: "solar-pro3" },
  balanced: { anthropic: "claude-sonnet-4-6", upstage: "solar-pro3" },
  reasoning: { anthropic: "claude-opus-4-7", upstage: null },
};

// provider+keyName → env 변수명. 사용량 추적용 키 분리
// (default = 등록상담+회의록, consultations = 학생 케어 인사이트).
const KEY_ENV: Record<AiProvider, Record<AiKeyName, string>> = {
  anthropic: { default: "ANTHROPIC_API_KEY", consultations: "ANTHROPIC_API_KEY_CONSULTATIONS" },
  upstage: { default: "UPSTAGE_API_KEY", consultations: "UPSTAGE_API_KEY_CONSULTATIONS" },
};

/**
 * 실제 사용할 API 키 문자열(없으면 undefined). Upstage는 consultations 전용 키가 없으면 default
 * 키로 폴백(키 1개만 넣어도 동작 — 스무스). Anthropic은 빌링 분리 위해 폴백 없음(기존 동작 보존).
 */
export function resolveKey(provider: AiProvider, keyName: AiKeyName): string | undefined {
  const specific = process.env[KEY_ENV[provider][keyName]];
  if (specific) return specific;
  if (provider === "upstage") return process.env[KEY_ENV.upstage.default];
  return undefined;
}

/** env AI_PROVIDER로 기본 provider 선택(미설정 시 upstage = Solar Pro 3 기본). */
export function defaultProvider(): AiProvider {
  return process.env.AI_PROVIDER === "anthropic" ? "anthropic" : "upstage";
}

/**
 * 티어+키이름 → 실제 (provider, model). 기본 provider 키가 없으면 다른 provider로 1회 폴백(키
 * 있는 쪽) → 둘 다 없으면 모델이 있는 첫 candidate를 반환(이후 클라 생성에서 throw → 호출부 stub).
 * reasoning은 Anthropic 고정.
 *
 * `prefer`: 호출부가 특정 provider를 **선호**(강제 아님)하도록 지정. 그 provider를 후보 맨 앞으로
 * 올린다 — 키가 있으면 그걸 쓰고, 없으면 평소 폴백 순서로 떨어진다(무중단). 녹음 분석(회의·등록상담·
 * 학생상담)이 구조화 추출 품질 위해 `prefer:"anthropic"`로 Claude를 우선하는 데 쓴다.
 */
export function resolveModel(
  tier: AiTier,
  keyName: AiKeyName = "default",
  prefer?: AiProvider,
): { provider: AiProvider; model: string; keyName: AiKeyName } {
  const base: AiProvider[] =
    tier === "reasoning"
      ? ["anthropic"]
      : defaultProvider() === "upstage"
        ? ["upstage", "anthropic"]
        : ["anthropic", "upstage"];
  const order = prefer ? [prefer, ...base.filter((p) => p !== prefer)] : base;

  for (const provider of order) {
    const model = AI_MODELS[tier][provider];
    if (model && resolveKey(provider, keyName)) return { provider, model, keyName };
  }
  const provider = order.find((p) => AI_MODELS[tier][p]) ?? "anthropic";
  return { provider, model: AI_MODELS[tier][provider] ?? "claude-sonnet-4-6", keyName };
}
