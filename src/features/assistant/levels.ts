/**
 * 저장된 옛 대화의 level 열을 읽기 위한 호환 타입. 새 질문은 low만 저장하며 화면에서 강도를 고르지 않는다.
 */
export const ASSISTANT_LEVELS = ["low", "normal", "high"] as const;
export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];

export const DEFAULT_ASSISTANT_LEVEL = "low" as const;

export function isAssistantLevel(v: unknown): v is AssistantLevel {
  return typeof v === "string" && (ASSISTANT_LEVELS as readonly string[]).includes(v);
}
