import { describe, expect, it } from "vitest";
import { TEMPLATE_BODY_MAX, TEMPLATE_NAME_MAX } from "./defaults";
import { checkTemplateInput } from "./validate";

describe("checkTemplateInput", () => {
  it("정상 입력은 앞뒤 공백을 다듬어 통과", () => {
    expect(checkTemplateInput({ name: "  내 템플릿 ", body: "\n안녕하세요 {학생} 학부모님\r\n" })).toEqual({
      ok: true,
      name: "내 템플릿",
      body: "안녕하세요 {학생} 학부모님",
    });
  });

  it("이름·내용이 비면 거절", () => {
    expect(checkTemplateInput({ name: " ", body: "x" }).ok).toBe(false);
    expect(checkTemplateInput({ name: "a", body: "  " }).ok).toBe(false);
  });

  it("상한을 넘으면 거절", () => {
    expect(checkTemplateInput({ name: "가".repeat(TEMPLATE_NAME_MAX + 1), body: "x" }).ok).toBe(false);
    expect(checkTemplateInput({ name: "a", body: "x".repeat(TEMPLATE_BODY_MAX + 1) }).ok).toBe(false);
  });

  it("🔴 모르는 칸(오타)은 저장을 거절하고 무엇이 틀렸는지 말한다", () => {
    const r = checkTemplateInput({ name: "a", body: "진도: {진도2}\n{코멘트}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("{진도2}");
  });

  it("공백 섞인 토큰도 아는 칸이면 통과", () => {
    expect(checkTemplateInput({ name: "a", body: "{다음 테스트}" }).ok).toBe(true);
  });

  it("그림 칸은 한 줄에 혼자 있으면 통과", () => {
    expect(checkTemplateInput({ name: "a", body: "안녕하세요\n\n{시험결과지}\n\n  { 학습분석지 }  " }).ok).toBe(true);
  });

  it("🔴 그림 칸이 문장 속에 섞이면 거절 — 대괄호 글자가 학부모에게 나간다", () => {
    const r = checkTemplateInput({ name: "a", body: "결과지: {시험결과지}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("{시험결과지}");
  });

  it("🔴 같은 그림 칸 두 번이면 거절 — 같은 그림이 두 번 그려진다", () => {
    const r = checkTemplateInput({ name: "a", body: "{학습분석지}\n\n{학습분석지}" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("한 번만");
  });
});
