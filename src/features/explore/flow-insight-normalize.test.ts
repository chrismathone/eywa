import { describe, expect, it } from "vitest";
import { clipText, FLOW_TEXT_LIMITS, normalizeFlowInsight } from "./flow-insight-normalize";
import { flowInsightSchema } from "./flow-insight";

const base = {
  headline: "숙제 이행이 좋아지는 중",
  direction: "improving",
  themes: ["숙제 이행"],
  recentChange: "",
  watch: [],
  nextSteps: [],
  basis: "근거: 2026-09~11 · 4건",
};

describe("clipText", () => {
  it("한도 안이면 그대로", () => {
    expect(clipText("가나다", 3)).toBe("가나다");
  });
  it("넘치면 말줄임 포함 한도 길이 이하 · 끝쪽 띄어쓰기가 있으면 거기서", () => {
    const t = `${"가".repeat(190)} 나다라마바사아자차카타`;
    const c = clipText(t, 200);
    expect(c.length).toBeLessThanOrEqual(200);
    expect(c.endsWith("…")).toBe(true);
    expect(c).toBe(`${"가".repeat(190)}…`);
  });
  it("띄어쓰기가 없으면 글자에서 자른다", () => {
    const c = clipText("가".repeat(250), 200);
    expect(c).toBe(`${"가".repeat(199)}…`);
  });
  it("이모지(두 칸 글자)를 반으로 자르지 않는다 — 짝 없는 반쪽은 jsonb 저장이 거절한다", () => {
    const t = `${"가".repeat(198)}😀${"나".repeat(10)}`; // 😀 = 199·200번째 칸 → 199칸에서 자르면 앞 반쪽만 남는다
    const c = clipText(t, 200);
    expect(c).toBe(`${"가".repeat(198)}…`);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(c)).toBe(false);
    expect(() => JSON.parse(JSON.stringify(c))).not.toThrow();
  });
});

describe("normalizeFlowInsight", () => {
  it("넘친 글은 말줄임, 넘친 주제는 뺀다 · 빈 항목은 뺀다 · 개수는 앞에서", () => {
    const { value, adjusted } = normalizeFlowInsight({
      ...base,
      headline: "가".repeat(300),
      recentChange: "나".repeat(500),
      basis: "다".repeat(201),
      themes: ["  ", "짧은 주제", "라".repeat(FLOW_TEXT_LIMITS.theme + 1), "a", "b", "c", "d", "e", "f"],
      watch: ["", "하나", "둘", "셋", "넷", "다섯"],
      nextSteps: ["마".repeat(201)],
    });
    const v = flowInsightSchema.parse(value);
    expect(v.headline.length).toBe(200);
    expect(v.recentChange.length).toBe(400);
    expect(v.basis.length).toBe(200);
    expect(v.themes).toEqual(["짧은 주제", "a", "b", "c", "d", "e"]);
    expect(v.watch).toEqual(["하나", "둘", "셋", "넷"]);
    expect(v.nextSteps[0]!.length).toBe(200);
    expect(adjusted.sort()).toEqual(["basis", "headline", "nextSteps", "recentChange", "themes", "watch"]);
  });
  it("같은 결과를 다시 넣으면 그대로(저장된 요약 읽기도 같은 함수)", () => {
    const once = normalizeFlowInsight({ ...base, headline: "가 ".repeat(150), themes: ["x".repeat(61), "y"] }).value;
    const twice = normalizeFlowInsight(once);
    expect(twice.value).toEqual(once);
    expect(twice.adjusted).toEqual([]);
  });
  it("구조가 틀린 것은 고치지 않는다 — 검증이 거절한다", () => {
    expect(normalizeFlowInsight(null).value).toBeNull();
    expect(normalizeFlowInsight([1]).value).toEqual([1]);
    const wrong = normalizeFlowInsight({ ...base, themes: [1, "주제"], direction: "great" }).value;
    expect(() => flowInsightSchema.parse(wrong)).toThrow();
    expect((wrong as { themes: unknown[] }).themes).toEqual([1, "주제"]);
  });
  it("손대지 않았으면 손댄 칸이 없다(앞뒤 공백만 정리)", () => {
    const { value, adjusted } = normalizeFlowInsight({ ...base, headline: "  흐름  " });
    expect((value as { headline: string }).headline).toBe("흐름");
    expect(adjusted).toEqual([]);
  });
});
