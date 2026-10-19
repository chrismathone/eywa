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
  // 시간 제한을 직접 준다 — 안 주면 SDK가 비스트리밍 요청의 상한(max_tokens)이 21,333을 넘을 때 "스트리밍 필요"로 던진다
  // (generate.ts `OUTPUT_TOKEN_FLOOR` 64,000 · 2026-10-19 실측). 값은 SDK 기본(10분)과 같다 — 실제로는 라우트 기한(300초)이 먼저 끊는다.
  const client = new Anthropic({ apiKey: process.env[envName] as string, timeout: 10 * 60 * 1000 });
  clients.set(envName, client);
  return client;
}
