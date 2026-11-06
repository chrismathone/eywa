// 기능별 모델 고정 — 코드 기본(`FEATURE_MODELS`) · 운영 콘솔에서 고를 수 있는 모델(`AI_MODEL_CHOICES`) · 그 둘의 우선순위.
// **순수**(서버·클라 공용 — 운영 콘솔 화면도 읽는다). 고정값을 후보 사다리에 세우는 일은 models.ts `resolveModelChain`.
import type { AiProvider } from "./models";

/** 한 기능을 특정 모델로 고정한 값 — 그 회사가 막히면(키·잔액) 평소 폴백 사다리로 넘어간다. */
export type ModelPin = { provider: AiProvider; model: string };

/**
 * 기능별 **코드 기본 모델** — 티어 표와 다른 모델을 쓰는 기능만 적는다(나머지는 호출부의 tier·provider 그대로).
 * 🔴 2026-10-26 원장 *"딥시크로 바꾼거 다 클로드로 전환"* · *"전사 분석은 전부 sonnet 5.5로 돌리고, 간단하고 빠르게 작성해야하는
 *    수업보고서 멘트는 haiku 5.5로"* (Anthropic API 크레딧 지원) — 전사 분석 셋(폼 자동입력 · 콜&상담 분석 · 회의록)을 Sonnet 5.5로 고정.
 *    (그 전 2026-10-19엔 블라인드 비교로 DeepSeek V4.1 flash였다 — 형식 차이를 맞추던 저장 전 후처리
 *    enrollment/analysis-normalize · enrollment/form-normalize · meetings/analysis-normalize는 그대로 둔다(Claude 결과엔 할 일이 거의 없다).)
 *    Claude가 막히면(키·잔액) 평소 사다리로 DeepSeek에 넘어간다(`FALLBACK_LADDER`).
 * 지점마다 다른 모델을 쓰게 하는 것은 운영 콘솔의 'AI 모델' 탭(`tenant_ai_models`, 0375a)이 이 값보다 먼저다.
 */
export const FEATURE_MODELS: Readonly<Record<string, ModelPin>> = {
  enrollment_form_extract: { provider: "anthropic", model: "claude-sonnet-5-5" },
  enrollment_analysis: { provider: "anthropic", model: "claude-sonnet-5-5" },
  meeting_analysis: { provider: "anthropic", model: "claude-sonnet-5-5" },
  // 영상 설명 AI 참고 메모(2026-10-20 하네스 6차) — 판정 = Haiku 5.5 · 실수 확인 = Sonnet 5.5.
  // Haiku 확인자는 진짜 오류를 '애매'로 떨어뜨리고 도형 오탐을 '확정'해 확인만 Sonnet으로 둔다(26개 기준 정답 실측).
  video_review_judge: { provider: "anthropic", model: "claude-haiku-5-5" },
  video_review_verify: { provider: "anthropic", model: "claude-sonnet-5-5" },
  // 원생 흐름 분석(2026-11-03) — 상담·타임라인 기록을 읽고 방향을 판단하는 전사 분석류라 Sonnet 5.5.
  student_flow_consultations: { provider: "anthropic", model: "claude-sonnet-5-5" },
  student_flow_timeline: { provider: "anthropic", model: "claude-sonnet-5-5" },
};

/**
 * 운영 콘솔에서 지점·기능별로 **고를 수 있는 모델**(원장 2026-10-19 *"지점별로 ai모델 바꿀 수 있게"*). 이 목록 밖의 값은
 * 저장도 적용도 하지 않는다(DB에 이상한 값이 들어가도 무시 = 코드 기본). 회사는 Claude · DeepSeek 둘(Solar는 2026-10-19 뺐다).
 * `slow` = 추론이 길어 사람이 화면에서 기다리는 기능엔 못 고른다(멘트 폴백에 v4-pro를 걸었다가 86초 — 2026-08-28 실측).
 */
export const AI_MODEL_CHOICES = [
  { model: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", slow: false },
  { model: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", slow: false },
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
