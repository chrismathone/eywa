/**
 * Solar 인라인 툴콜 토큰 파서 — 순수 모듈(Vitest).
 *
 * 실측(2026-07-17 프로덕션 첫 질문): solar-pro3가 툴 호출을 구조화 `tool_calls` 필드가 아니라
 * **본문 텍스트 토큰**으로 뱉는 경우가 있다:
 *   `<|tool_call:begin|>7b5f2f9f7b<|tool_call:name|>search_students<|tool_call:args|>{"query": "김"}<|tool_call:end|>`
 * 루프가 tool_calls 필드만 보면 이 원문이 최종 답으로 저장·노출된다(raw 코드 노출 금지 위반).
 * → 파싱해 표준 툴 호출로 승격시키고, 파싱 후에도 토큰 잡음이 남은 답은 폐기한다.
 */

export type InlineToolCall = { id: string; name: string; args: string };

const INLINE_CALL_RE =
  /<\|tool_call:begin\|>([\s\S]*?)<\|tool_call:name\|>([\s\S]*?)<\|tool_call:args\|>([\s\S]*?)<\|tool_call:end\|>/g;

/** 본문에서 인라인 툴콜 블록을 추출하고, 블록을 제거한 나머지 텍스트를 돌려준다. */
export function parseInlineToolCalls(text: string): { calls: InlineToolCall[]; stripped: string } {
  const calls: InlineToolCall[] = [];
  const stripped = text
    .replace(INLINE_CALL_RE, (_match, id: string, name: string, args: string) => {
      calls.push({ id: id.trim(), name: name.trim(), args: args.trim() });
      return "";
    })
    .trim();
  return { calls, stripped };
}

/**
 * 특수 토큰 잡음 감지 — 파서가 못 삼킨 `<|…|>` 계열이 남아 있으면 그 답변은 사용자에게 내보내면
 * 안 된다(불완전 툴콜·추론 토큰 등). 오탐을 줄이기 위해 정확히 `<|` 로 시작하는 토큰만 본다.
 */
export function hasSpecialTokenNoise(text: string): boolean {
  return /<\|[\w:./-]*\|?>?/.test(text) && /<\|/.test(text);
}

/**
 * 마크다운 강조 제거 — 패널은 plain text 렌더라 `**91.76%**`가 별표 그대로 보인다(2026-07-17 실측,
 * 프롬프트 지시로도 Solar가 간헐 방출). 강조 마커만 벗기고 본문·불릿(-)은 보존한다.
 */
export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}
