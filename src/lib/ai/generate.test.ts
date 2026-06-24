import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseJsonLoose } from "./generate";
import { resolveModel } from "./models";

describe("parseJsonLoose", () => {
  it("plain JSON", () => {
    expect(parseJsonLoose('{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });
  it("```json 펜스 제거", () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("언어 없는 ``` 펜스", () => {
    expect(parseJsonLoose('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("앞뒤 잡설 섞인 응답에서 {…} 추출", () => {
    expect(parseJsonLoose('네, 결과입니다:\n{"a":1}\n도움이 되었길!')).toEqual({ a: 1 });
  });
  it("중첩 객체/배열", () => {
    expect(parseJsonLoose('{"focus":[{"priority":"high"}]}')).toEqual({
      focus: [{ priority: "high" }],
    });
  });
  it("JSON 없으면 throw", () => {
    expect(() => parseJsonLoose("그냥 텍스트")).toThrow();
  });
});

describe("resolveModel", () => {
  const KEYS = [
    "AI_PROVIDER",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_API_KEY_CONSULTATIONS",
    "UPSTAGE_API_KEY",
    "UPSTAGE_API_KEY_CONSULTATIONS",
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
  });
  afterEach(() => {
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  it("기본(provider 미설정) + Upstage 키 → Solar Pro 3", () => {
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModel("balanced")).toEqual({
      provider: "upstage",
      model: "solar-pro3",
      keyName: "default",
    });
  });

  it("AI_PROVIDER=anthropic + Anthropic 키 → Claude Sonnet", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "an";
    expect(resolveModel("balanced").provider).toBe("anthropic");
    expect(resolveModel("balanced").model).toBe("claude-sonnet-4-6");
  });

  it("기본 Upstage지만 Upstage 키 없고 Anthropic만 있으면 폴백", () => {
    process.env.ANTHROPIC_API_KEY = "an";
    expect(resolveModel("balanced").provider).toBe("anthropic");
  });

  it("reasoning은 AI_PROVIDER와 무관하게 Anthropic 고정", () => {
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModel("reasoning")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-7",
      keyName: "default",
    });
  });

  it("consultations 키: Upstage는 전용 키 없으면 default 키로 폴백", () => {
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModel("balanced", "consultations").provider).toBe("upstage");
  });

  it("prefer:anthropic → 기본 Upstage여도 Claude 우선(녹음 분석 라우팅)", () => {
    process.env.UPSTAGE_API_KEY = "up";
    process.env.ANTHROPIC_API_KEY = "an";
    const r = resolveModel("balanced", "default", "anthropic");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-4-6");
  });

  it("prefer:anthropic이라도 Anthropic 키 없으면 Upstage로 폴백(무중단)", () => {
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModel("balanced", "default", "anthropic").provider).toBe("upstage");
  });

  it("키가 하나도 없으면 기본 provider 모델 반환(이후 클라 생성서 throw → stub)", () => {
    expect(resolveModel("balanced").provider).toBe("upstage");
    expect(resolveModel("balanced").model).toBe("solar-pro3");
  });
});
