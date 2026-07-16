// AI 비서 대화 턴 — 순수 모듈(서버/클라 공용, Vitest). assistant_conversations.messages jsonb의
// 파싱·직렬화 단일 소스. DB jsonb는 신뢰하지 않고(스키마 밖 값·수동 조작 가능) 항상 검증을 거친다.

export type AssistantTurn = { role: "user" | "assistant"; content: string };
export type StoredTurn = AssistantTurn & { at: string };

/** DB messages jsonb → 검증된 턴 배열. 형식이 어긋난 항목은 조용히 건너뛴다(대화를 깨지 않음). */
export function parseStoredTurns(value: unknown): StoredTurn[] {
  if (!Array.isArray(value)) return [];
  const out: StoredTurn[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { role, content, at } = item as { role?: unknown; content?: unknown; at?: unknown };
    if (role !== "user" && role !== "assistant") continue;
    if (typeof content !== "string" || content.length === 0) continue;
    out.push({ role, content, at: typeof at === "string" ? at : "" });
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
): StoredTurn[] {
  const next = [
    ...existing,
    { role: "user" as const, content: question, at },
    { role: "assistant" as const, content: answer, at },
  ];
  return next.length > maxStored ? next.slice(next.length - maxStored) : next;
}
