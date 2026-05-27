import Anthropic from "@anthropic-ai/sdk";

/**
 * 모델 선택 가이드
 *   fast     — 짧은 분류/요약/태깅. 100ms 단위로 빠르고 저렴. 우선 후보.
 *   balanced — 회의록 요약, 학생 케어, 등록상담 진단 등 현재 대부분 작업.
 *              UX 우선이므로 기본값으로 사용.
 *   reasoning— 매우 복잡한 다단계 추론이 진짜 필요할 때만. 평소엔 금지.
 *
 * UI에서 사용자에게 model 이름을 노출하지 않습니다 — 운영자/학원장 입장에서
 * "claude-opus-4-7-2026-05-27" 같은 문자열은 의미 없는 노이즈입니다.
 */
export const CLAUDE_MODELS = {
  fast: "claude-haiku-4-5",
  balanced: "claude-sonnet-4-6",
  reasoning: "claude-opus-4-7",
} as const;

export type ModelTier = keyof typeof CLAUDE_MODELS;

/**
 * Named API keys to keep per-feature usage in separate billing buckets.
 *   default       — enrollment + meetings
 *   consultations — 학생 케어 인사이트 (/students/[id])
 */
export type AnthropicKeyName = "default" | "consultations";

const KEY_ENV: Record<AnthropicKeyName, string> = {
  default: "ANTHROPIC_API_KEY",
  consultations: "ANTHROPIC_API_KEY_CONSULTATIONS",
};

const clients = new Map<AnthropicKeyName, Anthropic>();

export function getAnthropic(keyName: AnthropicKeyName = "default"): Anthropic {
  const cached = clients.get(keyName);
  if (cached) return cached;

  const envVar = KEY_ENV[keyName];
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`${envVar} is not set`);
  }
  const client = new Anthropic({ apiKey });
  clients.set(keyName, client);
  return client;
}
