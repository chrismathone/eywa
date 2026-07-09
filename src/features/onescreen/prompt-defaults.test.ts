import { describe, it, expect } from "vitest";
import { interpolate, assembleSingle, assembleCombined, DEFAULT_PROMPTS } from "./prompt-defaults";

describe("interpolate", () => {
  it("{{key}}를 값으로 치환, 없는 키는 빈 문자열", () => {
    expect(interpolate("A {{x}} B {{y}}", { x: "1" })).toBe("A 1 B ");
    expect(interpolate("{{ facts }}", { facts: "hi" })).toBe("hi"); // 공백 허용
  });
});

describe("assembleSingle", () => {
  it("본문 뒤에 그 유형의 단일 JSON 출력 계약을 붙인다", () => {
    const p = assembleSingle("본문...", "comment");
    expect(p).toContain("본문...");
    expect(p).toContain('{"comment": "..."}');
    const t = assembleSingle("본문...", "trend");
    expect(t).toContain('{"trend": "..."}');
    // P1/P2는 단독일 때 comment 필드로 받는다
    expect(assembleSingle("x", "comment_p1")).toContain('{"comment": "..."}');
  });
});

describe("assembleCombined", () => {
  it("여러 섹션을 묶고 지정 필드를 담은 JSON 하나만 출력하게 한다", () => {
    const p = assembleCombined([
      { type: "comment", field: "comment", body: "멘트본문" },
      { type: "trend", field: "trend", body: "추세본문" },
    ]);
    expect(p).toContain("멘트본문");
    expect(p).toContain("추세본문");
    // 통합 출력 JSON 모양에 두 필드가 모두 있어야
    expect(p).toContain('{"comment": "...", "trend": "..."}');
    expect(p).toContain("항목 1");
    expect(p).toContain("항목 2");
  });

  it("모드 B 3섹션(p1·p2·trend) 필드가 통합 출력에 모두 반영", () => {
    const p = assembleCombined([
      { type: "comment_p1", field: "p1", body: "P1" },
      { type: "comment_p2", field: "p2", body: "P2" },
      { type: "trend", field: "trend", body: "T" },
    ]);
    expect(p).toContain('{"p1": "...", "p2": "...", "trend": "..."}');
  });
});

describe("DEFAULT_PROMPTS (본문)", () => {
  it("본문엔 자리표시자가 있고 출력 계약(‘[출력]’)은 없다(코드가 부착)", () => {
    expect(DEFAULT_PROMPTS.comment).toContain("{{facts}}");
    expect(DEFAULT_PROMPTS.trend).toContain("{{historySummary}}");
    expect(DEFAULT_PROMPTS.comment).not.toContain("[출력]");
    expect(DEFAULT_PROMPTS.trend).not.toContain("[출력]");
  });
});
