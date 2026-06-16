import Anthropic from "@anthropic-ai/sdk";
import { resolveKey, type AiKeyName } from "./models";

/**
 * Anthropic 클라이언트 팩토리(키 캐시). 모델 선택·provider 라우팅은 `./generate`의
 * `generateJSON` + `./models`의 `resolveModel`이 담당 — 직접 호출은 generate.ts에서만.
 * 키 분리(default = 등록상담+회의록, consultations = 학생 케어)는 `resolveKey`가 해석.
 */
const clients = new Map<AiKeyName, Anthropic>();

export function getAnthropic(keyName: AiKeyName = "default"): Anthropic {
  const cached = clients.get(keyName);
  if (cached) return cached;

  const apiKey = resolveKey("anthropic", keyName);
  if (!apiKey) {
    throw new Error(`Anthropic API key for "${keyName}" is not set`);
  }
  const client = new Anthropic({ apiKey });
  clients.set(keyName, client);
  return client;
}
