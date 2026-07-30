import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK 클라이언트 모킹 — 실제 네트워크 없이 generateJSON 폴백 경로를 결정적으로 검증.
const { upstageCreate, anthropicCreate } = vi.hoisted(() => ({
  upstageCreate: vi.fn(),
  anthropicCreate: vi.fn(),
}));
vi.mock("./upstage", () => ({
  getUpstage: () => ({ chat: { completions: { create: upstageCreate } } }),
}));
vi.mock("./anthropic", () => ({
  getAnthropic: () => ({ messages: { create: anthropicCreate } }),
}));

import { generateJSON, isRetryableProviderError, isTemperatureDeprecatedError, parseJsonLoose } from "./generate";
import { resolveModel, resolveModelChain } from "./models";

// usage 포함 — generateJSON이 usage를 캡처(0113a 계측)해도 파싱·폴백이 안 깨짐을 함께 검증.
const upstageOk = (json: string) => ({
  choices: [{ message: { content: json } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
});
const anthropicOk = (json: string) => ({
  content: [{ type: "text", text: json }],
  usage: { input_tokens: 100, output_tokens: 50 },
});

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
    expect(resolveModel("balanced").model).toBe("claude-sonnet-5");
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
    expect(r.model).toBe("claude-sonnet-5");
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

describe("isRetryableProviderError", () => {
  it("401/403/429 상태코드는 폴백 대상", () => {
    expect(isRetryableProviderError({ status: 401 })).toBe(true);
    expect(isRetryableProviderError({ status: 403 })).toBe(true);
    expect(isRetryableProviderError({ status: 429 })).toBe(true);
  });
  it("키 무효 메시지(상태 없음)도 폴백 대상", () => {
    expect(isRetryableProviderError(new Error("invalid API key"))).toBe(true);
    expect(isRetryableProviderError(new Error("Unauthorized"))).toBe(true);
  });
  it("파싱·400·5xx 등 그 외는 폴백 안 함", () => {
    expect(isRetryableProviderError({ status: 400 })).toBe(false);
    expect(isRetryableProviderError({ status: 500 })).toBe(false);
    expect(isRetryableProviderError(new Error("JSON parse error"))).toBe(false);
  });
});

describe("isTemperatureDeprecatedError", () => {
  const PROD_MESSAGE =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."},"request_id":"req_x"}';
  it("프로덕션 실측 메시지(Error/plain object 모두) 판별", () => {
    expect(isTemperatureDeprecatedError(Object.assign(new Error(PROD_MESSAGE), { status: 400 }))).toBe(true);
    expect(isTemperatureDeprecatedError({ status: 400, message: PROD_MESSAGE })).toBe(true);
  });
  it("무관한 400·기타 오류는 아님", () => {
    expect(isTemperatureDeprecatedError(Object.assign(new Error("bad request"), { status: 400 }))).toBe(false);
    expect(isTemperatureDeprecatedError(new Error("invalid API key"))).toBe(false);
  });
});

describe("resolveModelChain", () => {
  const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_CONSULTATIONS", "UPSTAGE_API_KEY", "UPSTAGE_API_KEY_CONSULTATIONS"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
  });
  afterEach(() => {
    KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  it("기본(upstage) + 양쪽 키 → [upstage, anthropic] 순", () => {
    process.env.UPSTAGE_API_KEY = "u";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModelChain("balanced", "default").map((c) => c.provider)).toEqual(["upstage", "anthropic"]);
  });
  it("upstage 키 없으면 키 있는 anthropic만(키 없는 후보 제외)", () => {
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModelChain("balanced", "default").map((c) => c.provider)).toEqual(["anthropic"]);
  });
  it("키가 하나도 없으면 빈 체인", () => {
    expect(resolveModelChain("balanced", "default")).toEqual([]);
  });
  it("reasoning 티어는 anthropic 고정", () => {
    process.env.UPSTAGE_API_KEY = "u";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModelChain("reasoning", "default").map((c) => c.provider)).toEqual(["anthropic"]);
  });
});

describe("generateJSON 폴백", () => {
  const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "UPSTAGE_API_KEY"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    upstageCreate.mockReset();
    anthropicCreate.mockReset();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.AI_PROVIDER = "upstage";
    process.env.UPSTAGE_API_KEY = "u";
    process.env.ANTHROPIC_API_KEY = "a";
  });
  afterEach(() => {
    KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  it("upstage 401 → anthropic로 자동 폴백해 성공", async () => {
    upstageCreate.mockRejectedValueOnce({ status: 401 });
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("claude-sonnet-5");
    expect(upstageCreate).toHaveBeenCalledOnce();
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  it("upstage 성공 시 anthropic 호출 안 함", async () => {
    upstageCreate.mockResolvedValueOnce(upstageOk('{"x":1}'));
    const { data } = await generateJSON<{ x: number }>({ prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ x: 1 });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("폴백 불가 오류(400)는 즉시 throw, 다음 provider 시도 안 함", async () => {
    upstageCreate.mockRejectedValueOnce({ status: 400, message: "bad request" });
    await expect(generateJSON({ prompt: "JSON 주세요", maxTokens: 100 })).rejects.toThrow();
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("anthropic temperature deprecated 400 → temperature만 떼고 같은 모델로 1회 재시도", async () => {
    anthropicCreate.mockRejectedValueOnce(
      Object.assign(new Error('400 {"error":{"message":"`temperature` is deprecated for this model."}}'), {
        status: 400,
      }),
    );
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({
      prompt: "JSON 주세요",
      maxTokens: 100,
      provider: "anthropic",
      temperature: 0.3,
    });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("claude-sonnet-5");
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(anthropicCreate.mock.calls[0][0]).toHaveProperty("temperature", 0.3);
    expect(anthropicCreate.mock.calls[1][0]).not.toHaveProperty("temperature");
    expect(upstageCreate).not.toHaveBeenCalled();
  });

  it("temperature 미지정이면 deprecated류 400도 재시도 없이 throw", async () => {
    anthropicCreate.mockRejectedValueOnce(
      Object.assign(new Error('400 {"error":{"message":"`temperature` is deprecated for this model."}}'), {
        status: 400,
      }),
    );
    await expect(
      generateJSON({ prompt: "JSON 주세요", maxTokens: 100, provider: "anthropic" }),
    ).rejects.toThrow();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

// 2026-07-30 — 멘트 출력에 줄바꿈을 허용하면서 추가. 모델이 `\n` 대신 **생 줄바꿈**을 흘리면
// JSON이 통째로 깨지고, 호출부는 "빈 응답"으로 떨어져 학부모에게 폴백 템플릿이 나간다.
describe("parseJsonLoose — 문자열 안 생 줄바꿈 복구", () => {
  it("값에 진짜 개행이 들어와도 살려낸다", () => {
    const raw = '{"comment": "오늘은 원기둥을 배웠습니다.\n오늘 과제는 쎈 3단원입니다."}';
    expect(parseJsonLoose<{ comment: string }>(raw).comment).toBe(
      "오늘은 원기둥을 배웠습니다.\n오늘 과제는 쎈 3단원입니다.",
    );
  });
  it("정상 JSON(이스케이프된 \n)은 그대로", () => {
    const raw = '{"comment": "첫 줄\n둘째 줄"}';
    expect(parseJsonLoose<{ comment: string }>(raw).comment).toBe("첫 줄\n둘째 줄");
  });
  it("구조 개행(들여쓰기)은 건드리지 않는다", () => {
    const raw = '{\n  "a": "1",\n  "b": "2"\n}';
    expect(parseJsonLoose<{ a: string; b: string }>(raw)).toEqual({ a: "1", b: "2" });
  });
  it("여러 값에 걸친 생 줄바꿈도 복구", () => {
    const raw = '{"comment": "가\n나", "trend": "다\n라"}';
    expect(parseJsonLoose<{ comment: string; trend: string }>(raw)).toEqual({ comment: "가\n나", trend: "다\n라" });
  });
  it("복구해도 못 읽는 응답은 여전히 throw", () => {
    expect(() => parseJsonLoose("완전히 JSON이 아님")).toThrow();
  });
});
