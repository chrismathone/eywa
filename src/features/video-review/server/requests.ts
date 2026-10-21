import "server-only";
import type { GenerateJSONOptions } from "@/lib/ai/generate";
import { JUDGE_SYSTEM, judgePrompt } from "../harness/prompt-judge";
import { VERIFY_SYSTEM, verifyMaterial, verifyPrompt, type MistakeClaim } from "../harness/prompt-verify";
import { REVIEW_FEATURE } from "../types";
import type { Material } from "./material";

/**
 * 판정·확인 요청 — 밤 배치와 '다시 분석'(즉시)이 **같은 요청**을 쓴다. 모델은 기능 이름으로 고정(model-pins: 판정 Haiku · 확인 Sonnet).
 * 응답 길이는 바닥(generate.ts OUTPUT_TOKEN_FLOOR)이 올려 보낸다 — 필기 옮겨 적기·검산표가 길어 작게 잡으면 잘린다.
 * 프롬프트 캐시(원장 2026-10-21 "최소요금") — 판정은 고정 지침(system)을 배치 30건이 공유 · 확인은 같은 영상의 주장 N개가
 * system·화면·자료(cachePrefix)를 공유. 배치에서는 최선 노력이라 실제 절감은 사용량 기록의 cache_read/write 칸으로 본다.
 */
export function judgeRequest(tenantId: string, m: Material): GenerateJSONOptions {
  return {
    system: JUDGE_SYSTEM,
    cacheSystem: true,
    prompt: judgePrompt(m.text, m.labels),
    maxTokens: 16_000,
    provider: "anthropic",
    images: m.images,
    meta: { tenantId, feature: REVIEW_FEATURE.judge },
  };
}

export function verifyRequest(tenantId: string, claim: MistakeClaim, m: Material): GenerateJSONOptions {
  return {
    system: VERIFY_SYSTEM,
    cachePrefix: verifyMaterial(m.text, m.labels),
    prompt: verifyPrompt(claim),
    maxTokens: 8_000,
    provider: "anthropic",
    images: m.images,
    meta: { tenantId, feature: REVIEW_FEATURE.verify },
  };
}
