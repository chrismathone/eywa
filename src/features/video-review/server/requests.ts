import "server-only";
import type { GenerateJSONOptions } from "@/lib/ai/generate";
import { judgePrompt } from "../harness/prompt-judge";
import { verifyPrompt, type MistakeClaim } from "../harness/prompt-verify";
import { REVIEW_FEATURE } from "../types";
import type { Material } from "./material";

/**
 * 판정·확인 요청 — 밤 배치와 '다시 분석'(즉시)이 **같은 요청**을 쓴다. 모델은 기능 이름으로 고정(model-pins: 판정 Haiku · 확인 Sonnet).
 * 응답 길이는 바닥(generate.ts OUTPUT_TOKEN_FLOOR)이 올려 보낸다 — 필기 옮겨 적기·검산표가 길어 작게 잡으면 잘린다.
 */
export function judgeRequest(tenantId: string, m: Material): GenerateJSONOptions {
  return {
    prompt: judgePrompt(m.text, m.labels),
    maxTokens: 16_000,
    provider: "anthropic",
    images: m.images,
    meta: { tenantId, feature: REVIEW_FEATURE.judge },
  };
}

export function verifyRequest(tenantId: string, claim: MistakeClaim, m: Material): GenerateJSONOptions {
  return {
    prompt: verifyPrompt(claim, m.text, m.labels),
    maxTokens: 8_000,
    provider: "anthropic",
    images: m.images,
    meta: { tenantId, feature: REVIEW_FEATURE.verify },
  };
}
