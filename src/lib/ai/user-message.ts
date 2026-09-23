/**
 * AI 호출 실패를 화면에 보여 줄 한 줄로 — `generateJSON`의 `rethrowAi`가 이미 한글로 바꿔 둔 사유
 * (잔액 소진·키 오류·사용량 한도)는 **그대로 통과**시키고, 그 밖의 원문(영문 SDK 오류 등)은 숨기고
 * 호출부의 일반 문구로 바꾼다(raw 오류 노출 금지 규약).
 *
 * 크레딧이 떨어졌는데 "실패했습니다"만 보이면 강사가 계속 다시 누른다(E11, 2026-09-23 감사).
 * 순수 함수(Vitest).
 */
const KNOWN_AI_REASONS = /^AI (잔액 소진|키 오류|사용량 한도 초과):/;

export function aiUserMessage(err: unknown, fallback: string): string {
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return KNOWN_AI_REASONS.test(msg) ? msg : fallback;
}
