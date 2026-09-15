import OpenAI from "openai";
import { resolveKeyEnv, type AiKeyGroup, type AiKeyName } from "./models";

/**
 * DeepSeek 클라이언트 팩토리(키 캐시). DeepSeek Chat API는 OpenAI 호환이라 `openai` SDK에
 * baseURL만 바꿔 그대로 사용한다(`chat.completions.create`). Upstage와 동일 패턴.
 * 모델 선택·provider 라우팅은 `./generate`의 `generateJSON`이 담당 — 직접 호출은 generate.ts에서만.
 * 키는 `resolveKeyEnv`가 고르고(기능 그룹 키 → 옛 버킷 → 기본 키), 캐시는 고른 env 이름 단위다.
 *
 * 현재 라인업(API `/models` 실조회, 2026-07-16): `deepseek-v4-pro`(고품질 추론)·`deepseek-v4-flash`(경량).
 * v4-pro는 답을 `message.content`에, 사고과정을 `reasoning_content`에 분리한다(generate.ts가 content 우선).
 */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

const clients = new Map<string, OpenAI>();

export function getDeepseek(keyName: AiKeyName = "default", group: AiKeyGroup | null = null): OpenAI {
  const envName = resolveKeyEnv("deepseek", keyName, group);
  if (!envName) {
    throw new Error(`DeepSeek API key for "${group ?? keyName}" is not set`);
  }
  const cached = clients.get(envName);
  if (cached) return cached;
  const client = new OpenAI({ apiKey: process.env[envName] as string, baseURL: DEEPSEEK_BASE_URL });
  clients.set(envName, client);
  return client;
}
