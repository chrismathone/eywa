import "server-only";

/**
 * 2026-11-13 원장 결정: 모든 질문을 Terra low 하나로 답한다. 화면·요청·옛 대화의 강도 값으로 바꾸지 않는다.
 * 지점 AI 모델 선택이나 다른 회사 폴백 사다리에도 연결하지 않는다.
 */
export const ASSISTANT_MODEL = { model: "gpt-6.1-terra", effort: "low" } as const;

/** 사용량 장부 · 키 그룹의 기능 이름. */
export const ASSISTANT_FEATURE = "academy_assistant";
