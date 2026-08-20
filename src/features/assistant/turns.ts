// AI 비서 대화 턴 — 순수 모듈(서버/클라 공용, Vitest). assistant_conversations.messages jsonb의
// 파싱·직렬화 단일 소스. DB jsonb는 신뢰하지 않고(스키마 밖 값·수동 조작 가능) 항상 검증을 거친다.

import { parseStoredLinks, type AssistantLink } from "./links";

export type AssistantTurn = { role: "user" | "assistant"; content: string };
/**
 * 저장 턴. `links`는 답변에 붙는 바로가기 버튼(2026-08-20) — **assistant 턴에만** 붙고,
 * 없으면 키 자체가 없다(마이그레이션 0: 기존 행은 links 없이 그대로 읽힌다).
 */
export type StoredTurn = AssistantTurn & { at: string; links?: AssistantLink[] };

/** DB messages jsonb → 검증된 턴 배열. 형식이 어긋난 항목은 조용히 건너뛴다(대화를 깨지 않음). */
export function parseStoredTurns(value: unknown): StoredTurn[] {
  if (!Array.isArray(value)) return [];
  const out: StoredTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { role, content, at, links } = item as {
      role?: unknown;
      content?: unknown;
      at?: unknown;
      links?: unknown;
    };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || content.length === 0) continue;
    const turn: StoredTurn = { role, content, at: typeof at === "string" ? at : "" };
    // 링크도 항목별 검증(종류 화이트리스트·uuid·라벨 길이) — 어긋난 항목만 버린다.
    if (role === "assistant" && links !== undefined) {
      const parsed = parseStoredLinks(links);
      if (parsed.length > 0) turn.links = parsed;
    }
    out.push(turn);
  }
  return out;
}

/** 기존 턴 + 이번 질문/응답 → 저장용 배열. 저장 길이는 상한으로 잘라 무한 성장 방지. */
export function appendTurns(
  existing: StoredTurn[],
  question: string,
  answer: string,
  at: string,
  maxStored = 60,
  links: AssistantLink[] = [],
): StoredTurn[] {
  const assistantTurn: StoredTurn = { role: "assistant", content: answer, at };
  if (links.length > 0) assistantTurn.links = links;
  const next = [...existing, { role: "user" as const, content: question, at }, assistantTurn];
  return next.length > maxStored ? next.slice(next.length - maxStored) : next;
}
