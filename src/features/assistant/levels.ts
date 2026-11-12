/**
 * 학원 비서 추론 강도 — 원장 2026-11-06 *"추론강도를 적음(하이쿠)/보통(소넷)/강함(오퍼스) 로 설정할 수 있게. 모델명은 숨기고"*.
 * 화면에는 적음·보통·강함만 보인다(모델 이름을 내려보내지 않는다). 순수 모듈 — 서버·화면 공용.
 */
export const ASSISTANT_LEVELS = ["low", "normal", "high"] as const;
export type AssistantLevel = (typeof ASSISTANT_LEVELS)[number];

export const ASSISTANT_LEVEL_LABEL: Readonly<Record<AssistantLevel, string>> = { low: "적음", normal: "보통", high: "강함" };
export const ASSISTANT_LEVEL_HINT: Readonly<Record<AssistantLevel, string>> = {
  // 멘트 시험 2026-11-11 — 적음은 원인·순위·사람 평가 질문에서 근거보다 세게 말했다(핵심 사실 오류 10회 중 5회). 보조 안내일 뿐(보통 이상이 늘 안전하다는 뜻은 아니다).
  low: "빠르고 가볍게 — 숫자 하나·명단 하나 · 원인·순위·사람 평가에는 맞지 않습니다",
  normal: "대부분의 질문",
  high: "여러 자료를 엮는 분석 — 느리고 비쌉니다",
};
export const DEFAULT_ASSISTANT_LEVEL: AssistantLevel = "normal";

export function isAssistantLevel(v: unknown): v is AssistantLevel {
  return typeof v === "string" && (ASSISTANT_LEVELS as readonly string[]).includes(v);
}

/**
 * 답이 끝난 뒤 '추론 강도를 올려 다시 묻기'를 권할 강도 — **적음**으로 받은 답에만(원장 2026-11-12 *"추론 강도를 낮은 단계로 했을때 답변이
 * 모두 나왔을때, 마음에 들지 않으면 추론 강도를 올려서 다시 물어보시겠습니까? 라고 할것"*). 보통은 기본값이라 매번 권하지 않는다.
 * 돌려주는 값 = 올려 물을 수 있는 강도(낮은 것부터).
 */
export function raiseLevelsFor(level: AssistantLevel): AssistantLevel[] {
  return level === "low" ? ASSISTANT_LEVELS.filter((l) => l !== "low") : [];
}
