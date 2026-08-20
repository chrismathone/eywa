import { describe, expect, it } from "vitest";
import { hasSpecialTokenNoise, parseInlineToolCalls, stripMarkdownEmphasis } from "./solar-tokens";

describe("parseInlineToolCalls", () => {
  it("실측 원문(2026-07-17)을 파싱한다", () => {
    const raw =
      '<|tool_call:begin|>7b5f2f9f7b<|tool_call:name|>search_students<|tool_call:args|>{"query": "김"}<|tool_call:end|>';
    const { calls, stripped } = parseInlineToolCalls(raw);
    expect(calls).toEqual([{ id: "7b5f2f9f7b", name: "search_students", args: '{"query": "김"}' }]);
    expect(stripped).toBe("");
  });

  it("여러 블록 + 앞뒤 텍스트를 분리한다", () => {
    const raw =
      '조회하겠습니다. <|tool_call:begin|>a1<|tool_call:name|>get_billing_summary<|tool_call:args|>{}<|tool_call:end|><|tool_call:begin|>b2<|tool_call:name|>get_top_outstanding<|tool_call:args|>{"limit": 5}<|tool_call:end|>';
    const { calls, stripped } = parseInlineToolCalls(raw);
    expect(calls.map((c) => c.name)).toEqual(["get_billing_summary", "get_top_outstanding"]);
    expect(calls[1].args).toBe('{"limit": 5}');
    expect(stripped).toBe("조회하겠습니다.");
  });

  it("토큰이 없으면 원문 그대로", () => {
    const { calls, stripped } = parseInlineToolCalls("이번 달 수납률은 91.8%입니다.");
    expect(calls).toEqual([]);
    expect(stripped).toBe("이번 달 수납률은 91.8%입니다.");
  });
});

describe("hasSpecialTokenNoise", () => {
  it("파싱 못 한 특수 토큰이 남으면 감지", () => {
    expect(hasSpecialTokenNoise("<|tool_call:begin|>깨진 블록")).toBe(true);
    expect(hasSpecialTokenNoise("답변 <|im_end|>")).toBe(true);
  });
  it("정상 한국어 답변(비교 연산 포함)은 통과", () => {
    expect(hasSpecialTokenNoise("수납률은 91.8%입니다.")).toBe(false);
    expect(hasSpecialTokenNoise("3 < 5 이고 x > 1 입니다")).toBe(false);
  });
});

describe("stripMarkdownEmphasis(2026-08-20 전환 — 강조는 보존)", () => {
  it("**강조**는 렌더러가 그리므로 남긴다", () => {
    expect(stripMarkdownEmphasis("수납률 **91.8%**입니다")).toBe("수납률 **91.8%**입니다");
  });
  it("__밑줄__ 표기는 **로 통일", () => {
    expect(stripMarkdownEmphasis("__중요__ 합니다")).toBe("**중요** 합니다");
  });
  it("인라인 코드 백틱은 벗긴다(렌더러가 코드를 그리지 않는다)", () => {
    expect(stripMarkdownEmphasis("반 이름은 `DP5`입니다")).toBe("반 이름은 DP5입니다");
  });
  it("코드펜스 줄은 버리고 표 본문은 남긴다", () => {
    expect(stripMarkdownEmphasis("```markdown\n| a | b |\n```")).toBe("| a | b |");
  });
});
