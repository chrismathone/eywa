import OpenAI from "openai";
import { resolveKey, type AiKeyName } from "./models";

/**
 * DeepSeek 클라이언트 팩토리(키 캐시). DeepSeek Chat API는 OpenAI 호환이라 `openai` SDK에
 * baseURL만 바꿔 그대로 사용한다(`chat.completions.create`). Upstage와 동일 패턴.
 * 모델 선택·provider 라우팅은 `./generate`의 `generateJSON`이 담당 — 직접 호출은 generate.ts에서만.
 *
 * 현재 라인업(API `/models` 실조회, 2026-07-16): `deepseek-v4-pro`(고품질 추론)·`deepseek-v4-flash`(경량).
 * v4-pro는 답을 `message.content`에, 사고과정을 `reasoning_content`에 분리한다(generate.ts가 content 우선).
 */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const clients = new Map<AiKeyName, OpenAI>();

export function getDeepseek(keyName: AiKeyName = "default"): OpenAI {
  const cached = clients.get(keyName);
  if (cached) return cached;

  const apiKey = resolveKey("deepseek", keyName);
  if (!apiKey) {
    throw new Error(`DeepSeek API key for "${keyName}" is not set`);
  }
  const client = new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
  clients.set(keyName, client);
  return client;
}
