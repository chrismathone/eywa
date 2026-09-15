import OpenAI from "openai";
import { resolveKeyEnv, type AiKeyGroup, type AiKeyName } from "./models";

/**
 * Upstage Solar 클라이언트 팩토리(키 캐시). Upstage Chat API는 OpenAI 호환이라 `openai` SDK에
 * baseURL만 바꿔 그대로 사용한다(`chat.completions.create`). 모델 선택·provider 라우팅은
 * `./generate`의 `generateJSON`이 담당 — 직접 호출은 generate.ts에서만.
 * 키는 `resolveKeyEnv`가 고르고(기능 그룹 키 → 옛 버킷 → 기본 키), 캐시는 고른 env 이름 단위다.
 */
const UPSTAGE_BASE_URL = "https://api.upstage.ai/v1";

const clients = new Map<string, OpenAI>();

export function getUpstage(keyName: AiKeyName = "default", group: AiKeyGroup | null = null): OpenAI {
  const envName = resolveKeyEnv("upstage", keyName, group);
  if (!envName) {
    throw new Error(`Upstage API key for "${group ?? keyName}" is not set`);
  }
  const cached = clients.get(envName);
  if (cached) return cached;
  const client = new OpenAI({ apiKey: process.env[envName] as string, baseURL: UPSTAGE_BASE_URL });
  clients.set(envName, client);
  return client;
}
