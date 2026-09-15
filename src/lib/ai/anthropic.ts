import Anthropic from "@anthropic-ai/sdk";
import { resolveKeyEnv, type AiKeyGroup, type AiKeyName } from "./models";

/**
 * Anthropic 클라이언트 팩토리(키 캐시). 모델 선택·provider 라우팅은 `./generate`의
 * `generateJSON` + `./models`의 `resolveModel`이 담당 — 직접 호출은 generate.ts에서만.
 * 키는 `resolveKeyEnv`가 고른다(기능 그룹 키 → 옛 버킷 → 기본 키 — 원장 2026-09-15 기능별 키).
 * 캐시는 **실제로 고른 env 이름** 단위다 — 그룹마다 다른 키면 다른 클라이언트.
 */
const clients = new Map<string, Anthropic>();

export function getAnthropic(keyName: AiKeyName = "default", group: AiKeyGroup | null = null): Anthropic {
  const envName = resolveKeyEnv("anthropic", keyName, group);
  if (!envName) {
    throw new Error(`Anthropic API key for "${group ?? keyName}" is not set`);
  }
  const cached = clients.get(envName);
  if (cached) return cached;
  const client = new Anthropic({ apiKey: process.env[envName] as string });
  clients.set(envName, client);
  return client;
}
