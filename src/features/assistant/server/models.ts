import "server-only";
import type { AssistantLevel } from "../levels";

/**
 * 강도 → 모델·effort(서버 전용 — 모델 이름은 화면에 내려가지 않는다). Claude 전용으로 고정한다: 학원 전체 자료를 읽는 기능이라
 * 지점 'AI 모델' 탭(Claude·ChatGPT 선택)의 대상이 아니다(`FIXED_MODEL_FEATURES.academy_assistant`).
 * effort: Haiku·Opus 5.5는 기본이 medium이라 늘 명시한다. Sonnet 5.5는 도구를 여러 번 쓰는 일에 medium부터 권한다.
 */
export const ASSISTANT_MODEL: Readonly<Record<AssistantLevel, { model: string; effort: "low" | "medium" | "high" }>> = {
  low: { model: "claude-haiku-5-5", effort: "low" },
  normal: { model: "claude-sonnet-5-5", effort: "medium" },
  high: { model: "claude-opus-5-5", effort: "high" },
};

/** 사용량 장부 · 키 그룹의 기능 이름. */
export const ASSISTANT_FEATURE = "academy_assistant";
