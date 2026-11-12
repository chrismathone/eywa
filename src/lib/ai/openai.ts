import OpenAI from "openai";
import { resolveKeyEnv, type AiKeyGroup, type AiKeyName } from "./models";

/**
 * OpenAI 클라이언트 팩토리(키 캐시). 기본 OpenAI API 주소를 사용한다.
 * 모델 선택·provider 라우팅은 `generateJSON`이 담당하고, 키는 기능 그룹 → 옛 버킷 → 기본 키 순서다.
 */
const clients = new Map<string, OpenAI>();

export function getOpenAI(keyName: AiKeyName = "default", group: AiKeyGroup | null = null): OpenAI {
  const envName = resolveKeyEnv("openai", keyName, group);
  if (!envName) throw new Error(`OpenAI API key for "${group ?? keyName}" is not set`);
  const cached = clients.get(envName);
  if (cached) return cached;
  const client = new OpenAI({ apiKey: process.env[envName] as string, timeout: 10 * 60 * 1000 });
  clients.set(envName, client);
  return client;
}
