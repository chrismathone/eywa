import { describe, it, expect } from "vitest";
import {
  interpolate,
  assembleSingle,
  assembleCombined,
  DEFAULT_PROMPTS,
  TONE_RULES,
  CROSS_SECTION_RULES,
  promptUsedInModes,
  isPromptInUse,
} from "./prompt-defaults";

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

// 원장 2026-10-15 "말투도 좀 더 부드럽게. ai스럽지않게. 중복되는 내용 넣지않게" — 원장이 본문을 고쳐도 남도록 코드가 붙인다.
describe("말투 바닥 · 항목 간 되풀이 금지(코드가 붙임)", () => {
  it("단일·통합 조립 모두 말투 바닥이 붙는다", () => {
    expect(assembleSingle("본문", "comment")).toContain(TONE_RULES);
    expect(assembleSingle("본문", "trend")).toContain(TONE_RULES);
    expect(assembleCombined([{ type: "comment", field: "comment", body: "멘트" }])).toContain(TONE_RULES);
  });
  it("학습 추세가 함께 있을 때만 항목 간 되풀이 금지가 붙는다", () => {
    expect(
      assembleCombined([
        { type: "comment", field: "comment", body: "멘트" },
        { type: "trend", field: "trend", body: "추세" },
      ]),
    ).toContain(CROSS_SECTION_RULES);
    expect(assembleCombined([{ type: "comment", field: "comment", body: "멘트" }])).not.toContain(CROSS_SECTION_RULES);
  });
  it("보고서 말투를 이름으로 막는다 · 문장 끝은 강제하지 않는다(선생님 말투 지침이 정한다)", () => {
    expect(TONE_RULES).toContain("모습을 보였습니다");
    expect(TONE_RULES).toContain("말투 지침이 있으면 그것을");
  });
  it("🔴 추세 예시가 실데이터(권민서A 4/5·5/5·1/5) 모양이 아니고, 학원 계획 문장이 없다", () => {
    expect(DEFAULT_PROMPTS.trend).not.toContain("1/5");
    expect(DEFAULT_PROMPTS.trend).not.toContain("챙겨 보려");
    expect(DEFAULT_PROMPTS.comment).not.toContain("무리 없이 따라왔");
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

// 2026-07-21 배선 점검: 편집 화면에 4종이 나란히 있지만 모드에 따라 실제로 쓰이는 건 일부뿐이다.
// 이걸 화면이 안 알려주면 원장이 '저장은 되는데 아무도 안 읽는' 프롬프트를 직접 만들게 된다.
describe("promptUsedInModes / isPromptInUse", () => {
  it("모드 A는 comment만, 모드 B는 P1·P2만", () => {
    expect(promptUsedInModes("comment")).toEqual(["A"]);
    expect(promptUsedInModes("comment_p1")).toEqual(["B"]);
    expect(promptUsedInModes("comment_p2")).toEqual(["B"]);
  });

  it("학습 추세는 모드와 무관하게 항상 쓰인다", () => {
    expect(promptUsedInModes("trend")).toBe("always");
    expect(isPromptInUse("trend", new Set())).toBe(true);
    expect(isPromptInUse("trend", new Set(["A"]))).toBe(true);
  });

  it("학원이 모드 A만 쓰면 P1·P2는 미사용", () => {
    const used = new Set(["A"]);
    expect(isPromptInUse("comment", used)).toBe(true);
    expect(isPromptInUse("comment_p1", used)).toBe(false);
    expect(isPromptInUse("comment_p2", used)).toBe(false);
  });

  it("강사 한 명이라도 모드 B면 P1·P2도 사용 중", () => {
    const used = new Set(["A", "B"]);
    expect(isPromptInUse("comment", used)).toBe(true);
    expect(isPromptInUse("comment_p1", used)).toBe(true);
  });

  it("모드 B만 쓰면 단일 comment는 미사용", () => {
    expect(isPromptInUse("comment", new Set(["B"]))).toBe(false);
  });
});
