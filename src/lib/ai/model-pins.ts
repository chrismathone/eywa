// 기능별 모델 고정 — 코드 기본(`FEATURE_MODELS`) · 운영 콘솔에서 고를 수 있는 모델(`AI_MODEL_CHOICES`) · 그 둘의 우선순위.
// **순수**(서버·클라 공용 — 운영 콘솔 화면도 읽는다). 고정값을 후보 사다리에 세우는 일은 models.ts `resolveModelChain`.
import type { AiProvider } from "./models";

/** 한 기능을 특정 모델로 고정한 값 — 그 회사가 막히면(키·잔액) 평소 폴백 사다리로 넘어간다. */
export type ModelPin = { provider: AiProvider; model: string };

/**
 * 기능별 **코드 기본 모델** — 티어 표와 다른 모델을 쓰는 기능만 적는다(나머지는 호출부의 tier·provider 그대로).
 * 🔴 2026-10-19 원장 *"추천 순서로 진행"* — 운영 프롬프트 그대로의 블라인드 비교(폼 10 · 콜&상담 분석 5 · 회의록 5)에서
 *    V4.1 flash가 폼 8승 2무(Sonnet 5는 4건이 4,096 토큰에서 잘려 실패) · 회의록 4승 1무 · 콜&상담 분석 3:2로 같거나 나았고,
 *    값은 1/4~1/8 · 속도는 약 2배였다. 형식 차이는 각 기능의 저장 전 후처리(enrollment/analysis-normalize ·
 *    enrollment/form-normalize · meetings/analysis-normalize)가 기존 모양으로 맞춘다.
 *    재원생 상담·브리프·결석 문자 판별 등 **시험하지 않은 기능은 그대로**(v4-pro) — 넓힐 땐 같은 시험을 먼저.
 * 지점마다 다른 모델을 쓰게 하는 것은 운영 콘솔의 'AI 모델' 탭(`tenant_ai_models`, 0374a)이 이 값보다 먼저다.
 */
export const FEATURE_MODELS: Readonly<Record<string, ModelPin>> = {
  enrollment_form_extract: { provider: "deepseek", model: "deepseek-flash" },
  enrollment_analysis: { provider: "deepseek", model: "deepseek-flash" },
  meeting_analysis: { provider: "deepseek", model: "deepseek-flash" },
};

/**
 * 운영 콘솔에서 지점·기능별로 **고를 수 있는 모델**(원장 2026-10-19 *"지점별로 ai모델 바꿀 수 있게"*). 이 목록 밖의 값은
 * 저장도 적용도 하지 않는다(DB에 이상한 값이 들어가도 무시 = 코드 기본). Solar는 품질 시험 탈락이라 폴백 맨 뒤에만 둔다.
 * `slow` = 추론이 길어 사람이 화면에서 기다리는 기능엔 못 고른다(멘트 폴백에 v4-pro를 걸었다가 86초 — 2026-08-28 실측).
 */
export const AI_MODEL_CHOICES = [
  { model: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", slow: false },
  { model: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5", slow: false },
  { model: "deepseek-flash", provider: "deepseek", label: "DeepSeek V4.1 flash", slow: false },
  { model: "deepseek-v4-pro", provider: "deepseek", label: "DeepSeek v4-pro", slow: true },
] as const satisfies readonly { model: string; provider: AiProvider; label: string; slow: boolean }[];

/** 고른 모델 id → 고정값(목록 밖이면 null). */
export function choicePin(model: unknown): ModelPin | null {
  const hit = AI_MODEL_CHOICES.find((c) => c.model === model);
  return hit ? { provider: hit.provider, model: hit.model } : null;
}

/**
 * 모델을 고르는 단위의 기능 이름 — 멘트 미리보기는 **운영 자동작성과 같은 모델**이어야 해서(결정 2026-10-16
 * "미리보기 = 운영과 같게") 따로 고르지 않고 `classnote_ment`를 따른다.
 */
export function modelFeatureOf(feature?: string | null): string | null {
  if (!feature) return null;
  return feature === "ment_prompt_preview" ? "classnote_ment" : feature;
}

/**
 * 이 호출의 모델 고정값 — 지점 선택(운영 콘솔) > 코드 기본(`FEATURE_MODELS`) > 없음(호출부 tier·provider).
 * 원형 속성 이름(`constructor` 등)은 거른다.
 */
export function featurePin(feature?: string | null, tenantChoice?: string | null): ModelPin | null {
  const fromTenant = choicePin(tenantChoice);
  if (fromTenant) return fromTenant;
  const key = modelFeatureOf(feature);
  if (!key || !Object.prototype.hasOwnProperty.call(FEATURE_MODELS, key)) return null;
  return FEATURE_MODELS[key] ?? null;
}
