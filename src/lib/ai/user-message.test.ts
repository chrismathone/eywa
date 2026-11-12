import { describe, expect, it } from "vitest";
import { aiUserMessage } from "./user-message";

describe("aiUserMessage", () => {
  const fb = "AI 자동작성에 실패했습니다.";
  it("한글로 분류된 사유는 그대로", () => {
    const m = "AI 잔액 소진: Anthropic(Claude) 크레딧이 모두 소진되어 호출할 수 없습니다.";
    expect(aiUserMessage(new Error(m), fb)).toBe(m);
    expect(aiUserMessage(new Error("AI 키 오류: OpenAI API 키가 유효하지 않습니다(401)."), fb)).toMatch(/^AI 키 오류/);
    expect(aiUserMessage(new Error("AI 사용량 한도 초과: x"), fb)).toMatch(/^AI 사용량/);
  });
  it("영문 원문·알 수 없는 값은 일반 문구", () => {
    expect(aiUserMessage(new Error("400 Bad Request: invalid json"), fb)).toBe(fb);
    expect(aiUserMessage({ message: "AI 잔액 소진: x" }, fb)).toBe(fb);
    expect(aiUserMessage(undefined, fb)).toBe(fb);
  });
});
