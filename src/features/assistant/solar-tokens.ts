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
 * 답변 마크다운 정규화(이름은 이력 추적을 위해 유지).
 *
 * 2026-07-17: 패널이 plain text 렌더라 `**91.76%**`가 별표 그대로 보여 **강조 마커까지 벗겼다.**
 * 2026-08-20 **전환**: 패널이 안전 렌더러([rich-answer.ts](src/features/assistant/rich-answer.ts) +
 * answer-body.tsx)로 바뀌어 표·목록·강조를 제대로 그린다 → **`**강조**`는 보존**하고(렌더러가
 * <strong>으로 만든다) 렌더러가 다루지 않는 마커만 벗긴다: 인라인 코드 백틱·코드펜스 줄.
 * `__x__`는 `**x**`로 통일(같은 뜻인데 두 표기가 섞이면 한쪽만 렌더된다).
 * ⚠️ 특수 토큰 폐기 규약(hasSpecialTokenNoise)은 그대로 — 이건 마크다운이지 툴콜 토큰이 아니다.
 */
export function stripMarkdownEmphasis(text: string): string {
  return text
    .replace(/^\s*```.*$/gm, "") // 코드펜스 줄 제거(내용은 남는다 — 표를 감싸 오는 경우가 있다)
    .replace(/__([^_]+)__/g, "**$1**")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}
