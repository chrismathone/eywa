import OpenAI from "openai";
import { resolveKey, type AiKeyName } from "./models";

/**
 * Upstage Solar 클라이언트 팩토리(키 캐시). Upstage Chat API는 OpenAI 호환이라 `openai` SDK에
 * baseURL만 바꿔 그대로 사용한다(`chat.completions.create`). 모델 선택·provider 라우팅은
 * `./generate`의 `generateJSON`이 담당 — 직접 호출은 generate.ts에서만.
 */
const UPSTAGE_BASE_URL = "https://api.upstage.ai/v1";

const clients = new Map<AiKeyName, OpenAI>();

export function getUpstage(keyName: AiKeyName = "default"): OpenAI {
  const cached = clients.get(keyName);
  if (cached) return cached;

  const apiKey = resolveKey("upstage", keyName);
  if (!apiKey) {
    throw new Error(`Upstage API key for "${keyName}" is not set`);
  }
  const client = new OpenAI({ apiKey, baseURL: UPSTAGE_BASE_URL });
  clients.set(keyName, client);
  return client;
}
