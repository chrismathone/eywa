/**
 * 업무 비서 후보 — 화면이 서버에 보내는 모양의 검증(버튼 'AI로 정리' · 마지막 후보 남기기 · 같은 모양).
 * 일반 모듈(zod) — 라우트 둘이 함께 쓴다. 상한은 화면이 후보를 만들 때 자르는 값과 같다(`INPUT_LIMITS`).
 */
import { z } from "zod";
import { INPUT_BYTES, INPUT_LIMITS as L, inputBytes } from "./secretary-ai";

const ACTS = ["request", "detail", "tasks", "work", "link"] as const;

export const secretaryInputSchema = z.object({
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string().max(2),
  day: z.number().int().min(1).max(31),
  candidates: z.array(z.object({
    ref: z.string().min(1).max(80), title: z.string().max(L.title), why: z.string().max(L.why),
    count: z.number().int().min(0).max(L.count), facts: z.array(z.string().max(L.line)).max(L.facts), act: z.enum(ACTS),
  })).min(1).max(L.candidates),
  delegated: z.array(z.string().max(L.line)).max(L.delegated),
  names: z.array(z.string().max(L.name)).max(L.names),
}).refine((input) => inputBytes(input) <= INPUT_BYTES); // 표 제약(200,000바이트) 안 — 화면은 만들 때 이 안으로 줄인다

/** JSON 본문만 받는다(폼 전송으로 위장한 요청을 막는다). 형식이 틀리면 null. */
export async function readSecretaryInput(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  const parsed = secretaryInputSchema.safeParse(await request.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}
