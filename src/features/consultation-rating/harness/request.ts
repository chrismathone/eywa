import type { GenerateJSONOptions } from "@/lib/ai/generate";
import { CONSULT_SYSTEM, buildConsultationPrompt } from "./prompt";
import type { ConsultationRatingInput } from "./types";

/** generateJSON `meta.feature` — 키 그룹 표(models.ts)·모델 고정 문구(model-features.ts)와 같은 이름. */
export const RATING_FEATURE = "student_consultation_rating";

/**
 * 요청 한 건 — **배치(server/batch.ts) · 즉시 호출(server/rate-now.ts) · 구독 CLI 백필(scripts/_oneoff/consult-rating/rate.ts)이 같은 것을 쓴다**
 * (바꾸면 셋 다 — 그래야 백필 점수와 운영 점수가 같은 눈금이다). 시스템 지침 = 기준 문안.
 * keyName "consultations" = 재원생 상담 분석과 같은 청구 키(키 그룹 CONSULTATIONS — 가드 key-groups.test가 예전 키 라우팅과의 일치를 본다).
 */
export function ratingRequest(tenantId: string, c: ConsultationRatingInput): GenerateJSONOptions {
  return {
    keyName: "consultations", system: CONSULT_SYSTEM, cacheSystem: true, prompt: buildConsultationPrompt(c), maxTokens: 8_000, tier: "fast", provider: "anthropic",
    allowedProviders: ["anthropic"], reasoningEffort: "medium", meta: { feature: RATING_FEATURE, tenantId },
  };
}
