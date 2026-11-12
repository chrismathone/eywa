import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK 클라이언트 모킹 — 실제 네트워크 없이 generateJSON 폴백 경로를 결정적으로 검증.
const { openaiCreate, anthropicCreate } = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  anthropicCreate: vi.fn(),
}));
// 지점 라이선스 조회는 DB를 부른다 — 이 파일은 provider 동작만 보므로 늘 허용으로 둔다(라이선스 자체는 license.test.ts).
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
const TEST_META = { tenantId: "tenant-test", feature: "test" };

vi.mock("./openai", () => ({
  getOpenAI: () => ({ chat: { completions: { create: openaiCreate } } }),
}));
vi.mock("./anthropic", () => ({
  getAnthropic: () => ({ messages: { create: anthropicCreate } }),
}));

import {
  AnthropicRefusalError,
  anthropicRequestParams,
  anthropicUsage,
  callSyntheticFallbackForSmoke,
  generateJSON,
  isClaude5Model,
  isCreditExhaustedError,
  isRetryableProviderError,
  isTemperatureDeprecatedError,
  OUTPUT_TOKEN_FLOOR,
  openAIRequestParams,
  parseJsonLoose,
  sentMaxTokens,
  WAITING_OUTPUT_TOKEN_FLOOR,
} from "./generate";
import { resolveModel, resolveModelChain } from "./models";

// usage 포함 — generateJSON이 usage를 캡처(0113a 계측)해도 파싱·폴백이 안 깨짐을 함께 검증.
const openaiOk = (json: string) => ({
  choices: [{ message: { content: json } }],
  usage: { prompt_tokens: 100, completion_tokens: 50 },
  model: "gpt-6.1-terra",
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
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_CONSULTATIONS",
    "UPSTAGE_API_KEY",
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

  it("기본(AI_PROVIDER 미설정) + Anthropic 키 → Claude Sonnet 5.5(2026-10-19 Solar 제거 — 예전 미설정 기본은 Solar)", () => {
    process.env.ANTHROPIC_API_KEY = "an";
    expect(resolveModel("balanced")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
      keyName: "default",
    });
  });

  it("옛 AI_PROVIDER=openai 값은 1순위를 바꾸지 않는다", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "o";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModel("balanced").provider).toBe("anthropic");
    expect(resolveModel("balanced").model).toBe("claude-sonnet-5-5");
  });

  it("옛 값 AI_PROVIDER=upstage는 Claude로 읽는다(Solar 키가 남아 있어도 안 쓴다)", () => {
    process.env.AI_PROVIDER = "upstage";
    process.env.UPSTAGE_API_KEY = "up";
    process.env.ANTHROPIC_API_KEY = "an";
    expect(resolveModel("balanced").provider).toBe("anthropic");
  });

  it("기본 Claude지만 Anthropic 키 없고 OpenAI만 있으면 폴백", () => {
    process.env.OPENAI_API_KEY = "ds";
    expect(resolveModel("balanced").provider).toBe("openai");
  });

  it("reasoning은 AI_PROVIDER와 무관하게 Anthropic 고정", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "ds";
    expect(resolveModel("reasoning")).toEqual({
      provider: "anthropic",
      model: "claude-opus-4-7",
      keyName: "default",
    });
  });

  it("consultations 키: OpenAI은 전용 키 없으면 default 키로 폴백", () => {
    process.env.OPENAI_API_KEY = "ds";
    expect(resolveModel("balanced", "consultations").provider).toBe("openai");
  });

  it("prefer:anthropic → 기본 OpenAI이어도 Claude 우선", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_API_KEY = "ds";
    process.env.ANTHROPIC_API_KEY = "an";
    const r = resolveModel("balanced", "default", "anthropic");
    expect(r.provider).toBe("anthropic");
    expect(r.model).toBe("claude-sonnet-5-5");
  });

  it("prefer:anthropic이라도 Anthropic 키 없으면 OpenAI으로 폴백(무중단)", () => {
    process.env.OPENAI_API_KEY = "ds";
    expect(resolveModel("balanced", "default", "anthropic").provider).toBe("openai");
  });

  it("키가 하나도 없으면 기본 provider 모델 반환(이후 클라 생성서 throw → stub)", () => {
    expect(resolveModel("balanced").provider).toBe("anthropic");
    expect(resolveModel("balanced").model).toBe("claude-sonnet-5-5");
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

describe("isCreditExhaustedError — 2026-08-27 크레딧 소진 사고 재발 방지", () => {
  // ai_usage_logs에 실제로 쌓인 원문(8/27 77건·8/28 32건 전부 이것). 상태가 **400**이라
  // 401/403/429만 보던 판정을 통과 못 해 폴백 사다리를 안 탔고, 학부모 49명에게 특이사항이
  // 빠진 폴백 템플릿 문구가 나갔다.
  const ANTHROPIC_CREDIT =
    '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CeV1dhy7E4u5PgkxdWLo7"}';

  it("🔴 Anthropic 크레딧 소진(400)은 폴백 대상", () => {
    expect(isCreditExhaustedError(new Error(ANTHROPIC_CREDIT))).toBe(true);
    expect(isRetryableProviderError(new Error(ANTHROPIC_CREDIT))).toBe(true);
    expect(isRetryableProviderError(Object.assign(new Error(ANTHROPIC_CREDIT), { status: 400 }))).toBe(true);
  });

  it("plain object로 온 오류도 message를 읽는다(String(obj)='[object Object]' 함정)", () => {
    expect(isCreditExhaustedError({ status: 400, message: ANTHROPIC_CREDIT })).toBe(true);
  });

  it("provider마다 모양이 다르다 — OpenAI 402·잔액 문구·OpenAI 호환 quota", () => {
    expect(isCreditExhaustedError({ status: 402 })).toBe(true); // OpenAI Payment Required
    expect(isCreditExhaustedError(new Error("Insufficient Balance"))).toBe(true);
    expect(isRetryableProviderError(new Error('{"code":"insufficient_quota"}'))).toBe(true);
    expect(isCreditExhaustedError({ status: 429, error: { code: "insufficient_quota" } })).toBe(true);
    expect(isRetryableProviderError(new Error("You exceeded your current quota, please check your plan"))).toBe(true);
  });

  it("잔액과 무관한 400/5xx·파싱 실패는 그대로 폴백 안 함(오탐 금지)", () => {
    expect(isCreditExhaustedError({ status: 400, message: "bad request" })).toBe(false);
    expect(isCreditExhaustedError(new Error("JSON parse error"))).toBe(false);
    expect(isCreditExhaustedError({ status: 500 })).toBe(false);
    expect(isRetryableProviderError({ status: 400, message: "bad request" })).toBe(false);
  });
});

describe("폴백 사다리 = anthropic → openai 둘뿐(2026-10-19 Solar 제거)", () => {
  // 원장 2026-08-28 "anthropic -> openai" · 2026-10-19 "솔라는 빼버려. 두개면 충분".
  const KEYS = [
    "AI_PROVIDER",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_CONSULTATIONS",
    "UPSTAGE_API_KEY",
  ];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
  });
  afterEach(() => {
    KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  it("🔴 Anthropic이 기본이면 다음은 OpenAI — Solar 키가 남아 있어도 서지 않는다", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "an";
    process.env.OPENAI_API_KEY = "ds";
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["anthropic", "openai"]);
    expect(resolveModelChain("balanced").map((c) => c.provider)).toEqual(["anthropic", "openai"]);
  });

  it("OpenAI 키가 없으면 Claude 하나", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "an";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["anthropic"]);
  });

  it("옛 AI_PROVIDER 값이 OpenAI여도 순서는 Anthropic → OpenAI", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.ANTHROPIC_API_KEY = "an";
    process.env.OPENAI_API_KEY = "ds";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["anthropic", "openai"]);
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
  const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_CONSULTATIONS", "OPENAI_API_KEY", "OPENAI_API_KEY_CONSULTATIONS"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
  });
  afterEach(() => {
    KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  it("기본(미설정 = anthropic) + 양쪽 키 → [anthropic, openai] 순", () => {
    process.env.OPENAI_API_KEY = "d";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModelChain("balanced", "default").map((c) => c.provider)).toEqual(["anthropic", "openai"]);
  });
  it("anthropic 키 없으면 키 있는 openai만(키 없는 후보 제외)", () => {
    process.env.OPENAI_API_KEY = "d";
    expect(resolveModelChain("balanced", "default").map((c) => c.provider)).toEqual(["openai"]);
  });
  it("키가 하나도 없으면 빈 체인", () => {
    expect(resolveModelChain("balanced", "default")).toEqual([]);
  });
  it("reasoning 티어는 anthropic 고정", () => {
    process.env.OPENAI_API_KEY = "d";
    process.env.ANTHROPIC_API_KEY = "a";
    expect(resolveModelChain("reasoning", "default").map((c) => c.provider)).toEqual(["anthropic"]);
  });
});

describe("generateJSON 폴백", () => {
  const KEYS = ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicCreate.mockReset();
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    delete process.env.AI_PROVIDER;
    process.env.OPENAI_API_KEY = "d";
    process.env.ANTHROPIC_API_KEY = "a";
  });
  afterEach(() => {
    KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k])));
  });

  it("회사 제한이 있으면 Claude 인증 실패도 OpenAI으로 넘기지 않는다", async () => {
    anthropicCreate.mockRejectedValueOnce({ status: 401, message: "invalid api key" });
    await expect(generateJSON({ meta: TEST_META, prompt: "판정", maxTokens: 1024, provider: "anthropic", tier: "fast",
      reasoningEffort: "low", allowedProviders: ["anthropic"] })).rejects.toThrow();
    expect(anthropicCreate).toHaveBeenCalledOnce(); expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("허용한 회사의 키가 없으면 다른 회사 키만으로 호출하지 않는다", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(generateJSON({ meta: TEST_META, prompt: "판정", maxTokens: 1024, allowedProviders: ["anthropic"] })).rejects.toThrow("API 키");
    expect(anthropicCreate).not.toHaveBeenCalled(); expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("배치의 중단 신호를 Claude SDK 요청까지 전달한다", async () => {
    const abort = new AbortController(); anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    await generateJSON({ meta: TEST_META, prompt: "판정", maxTokens: 1024, provider: "anthropic", allowedProviders: ["anthropic"], signal: abort.signal });
    expect(anthropicCreate.mock.calls[0]![1]).toEqual({ signal: abort.signal });
  });

  it("anthropic 401 → openai로 자동 폴백해 성공", async () => {
    anthropicCreate.mockRejectedValueOnce({ status: 401 });
    openaiCreate.mockResolvedValueOnce(openaiOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("gpt-6.1-terra");
    expect(openaiCreate).toHaveBeenCalledOnce();
    expect(anthropicCreate).toHaveBeenCalledOnce();
    expect(openaiCreate.mock.calls[0][0].messages.at(-1)?.content).toBe(
      anthropicCreate.mock.calls[0][0].messages[0]?.content,
    );
  });

  it("OpenAI를 명시해 성공하면 anthropic 호출 안 함", async () => {
    openaiCreate.mockResolvedValueOnce(openaiOk('{"x":1}'));
    const { data } = await generateJSON<{ x: number }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100, provider: "openai" });
    expect(data).toEqual({ x: 1 });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("DB 없는 연결 시험도 합성 Claude 실패 뒤 실제 사다리 순서로 OpenAI를 한 번 부른다", async () => {
    openaiCreate.mockResolvedValueOnce(openaiOk('{"ok":true}'));
    const result = await callSyntheticFallbackForSmoke<{ ok: boolean }>({
      syntheticAnthropicError: { status: 401, message: "synthetic" },
      openAIModel: "gpt-6-luna",
      maxCompletionTokens: 64,
      options: { prompt: "JSON으로 답해라", maxTokens: 16, tier: "fast" },
    });
    expect(result.attemptedProviders).toEqual(["anthropic", "openai"]);
    expect(result.data).toEqual({ ok: true });
    expect(openaiCreate).toHaveBeenCalledOnce();
    expect(openaiCreate.mock.calls[0][0].max_completion_tokens).toBe(64);
  });

  it("🔴 크레딧 소진(400)도 다음 provider로 폴백한다 — 2026-08-27 사고의 정확한 재현", async () => {
    anthropicCreate.mockRejectedValueOnce(
      Object.assign(
        new Error(
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
        ),
        { status: 400 },
      ),
    );
    openaiCreate.mockResolvedValueOnce(openaiOk('{"ok":true}'));
    const { data } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ ok: true }); // 종전엔 여기서 throw → 호출부가 폴백 템플릿으로 떨어졌다
    expect(openaiCreate).toHaveBeenCalledOnce();
  });

  it("폴백 불가 오류(400)는 즉시 throw, 다음 provider 시도 안 함", async () => {
    anthropicCreate.mockRejectedValueOnce({ status: 400, message: "bad request" });
    await expect(generateJSON({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 })).rejects.toThrow();
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("Claude 5 계열엔 temperature를 처음부터 안 보낸다 — 400 → 재시도 왕복 없이 한 번에(2026-10-16 Haiku 5.5 전환)", async () => {
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,
      prompt: "JSON 주세요",
      maxTokens: 100,
      provider: "anthropic",
      temperature: 0.3,
    });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("claude-sonnet-5-5");
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty("temperature");
    // 생각 토큰이 상한을 먹지 않게 바닥을 올린다(쓴 만큼만 과금).
    expect(anthropicCreate.mock.calls[0][0].max_tokens).toBe(OUTPUT_TOKEN_FLOOR.anthropic);
  });

  it("fast tier = Haiku 5.5 · 멘트의 reasoningEffort 'minimal' → effort low", async () => {
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,
      prompt: "JSON 주세요",
      maxTokens: 1000,
      provider: "anthropic",
      tier: "fast",
      temperature: 0.3,
      reasoningEffort: "minimal",
    });
    expect(model).toBe("claude-haiku-5-5");
    const params = anthropicCreate.mock.calls[0][0];
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params).not.toHaveProperty("temperature");
    expect(params.max_tokens).toBe(OUTPUT_TOKEN_FLOOR.anthropic);
  });

  it("Claude 5가 아닌 모델은 temperature를 보내고, deprecated류 400이면 떼고 같은 모델로 1회 재시도", async () => {
    anthropicCreate.mockRejectedValueOnce(
      Object.assign(new Error('400 {"error":{"message":"`temperature` is deprecated for this model."}}'), {
        status: 400,
      }),
    );
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,
      prompt: "JSON 주세요",
      maxTokens: 100,
      provider: "anthropic",
      tier: "reasoning",
      temperature: 0.3,
    });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("claude-opus-4-7");
    expect(anthropicCreate).toHaveBeenCalledTimes(2);
    expect(anthropicCreate.mock.calls[0][0]).toHaveProperty("temperature", 0.3);
    expect(anthropicCreate.mock.calls[0][0].max_tokens).toBe(100);
    expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty("output_config");
    expect(anthropicCreate.mock.calls[1][0]).not.toHaveProperty("temperature");
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("isClaude5Model — 5 계열만(4.x·날짜 접미 없는 ID)", () => {
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-mythos-5-1"])
      expect(isClaude5Model(m), m).toBe(true);
    for (const m of ["claude-haiku-4-5", "claude-opus-4-7", "claude-sonnet-4-6", "gpt-6-luna", "solar-pro3"])
      expect(isClaude5Model(m), m).toBe(false);
  });

  it("응답 길이 상한 = 호출부 값과 바닥 중 큰 값 · Claude 4.x 이하만 호출부 값 그대로(원장 2026-10-19 '팍팍 늘려')", () => {
    expect(sentMaxTokens("anthropic", "claude-sonnet-5-5", 900)).toBe(64_000);
    expect(sentMaxTokens("anthropic", "claude-haiku-5-5", 1200)).toBe(64_000);
    expect(sentMaxTokens("openai", "gpt-6-luna", 16000)).toBe(64_000);
    expect(sentMaxTokens("openai", "gpt-6.1-terra", 100_000)).toBe(100_000);
    expect(sentMaxTokens("anthropic", "claude-opus-4-7", 900)).toBe(900);
  });

  it("선생님이 기다리는 멘트는 Claude·OpenAI 모두 16,000 바닥", () => {
    expect(sentMaxTokens("anthropic", "claude-haiku-5-5", 1800, "classnote_ment")).toBe(16_000);
    expect(sentMaxTokens("anthropic", "claude-haiku-5-5", 1200, "english_ment")).toBe(16_000);
    expect(sentMaxTokens("anthropic", "claude-haiku-5-5", 1800, "ment_prompt_preview")).toBe(16_000); // 미리보기 = 자동작성과 같게
    expect(sentMaxTokens("openai", "gpt-6-luna", 1800, "classnote_ment")).toBe(16_000);
    expect(sentMaxTokens("anthropic", "claude-sonnet-5-5", 2048, "student_care")).toBe(16_000); // 직원이 버튼을 누르고 기다린다
    expect(sentMaxTokens("anthropic", "claude-haiku-5-5", 2048, "student_ontology_summary")).toBe(16_000);
    expect(sentMaxTokens("anthropic", "claude-sonnet-5-5", 1200, "ment_style_profile")).toBe(64_000); // 주 1회 cron — 기다리지 않는다
  });

  it("기다리는 기능의 낮은 바닥이 실제 요청까지 간다(호출 지점이 기능 이름을 빠뜨리면 여기서 빨개진다)", async () => {
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    await generateJSON({ meta: { tenantId: "tenant-test", feature: "classnote_ment" }, prompt: "JSON 주세요", maxTokens: 1800, provider: "anthropic", tier: "fast" });
    expect(anthropicCreate.mock.calls[0][0].max_tokens).toBe(WAITING_OUTPUT_TOKEN_FLOOR.anthropic);
    openaiCreate.mockResolvedValueOnce(openaiOk('{"ok":true}'));
    await generateJSON({ meta: { tenantId: "tenant-test", feature: "english_ment" }, prompt: "JSON 주세요", maxTokens: 1200, provider: "openai", tier: "fast" });
    expect(openaiCreate.mock.calls[0][0].max_completion_tokens).toBe(WAITING_OUTPUT_TOKEN_FLOOR.openai);
    expect(openaiCreate.mock.calls[0][0]).not.toHaveProperty("max_tokens");
    expect(openaiCreate.mock.calls[0][0]).not.toHaveProperty("temperature");
    expect(openaiCreate.mock.calls[0][0].reasoning_effort).toBe("low");
  });

  it("잘린 응답의 오류 문구는 실제로 보낸 상한(바닥으로 올린 값)을 말한다", async () => {
    openaiCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"a": "중간에 끊' }, finish_reason: "length" }],
      usage: { prompt_tokens: 100, completion_tokens: 64000 },
    });
    await expect(generateJSON({ meta: TEST_META, prompt: "JSON 주세요", maxTokens: 100, provider: "openai" })).rejects.toThrow("최대 길이(64000 토큰)");
    expect(openaiCreate.mock.calls[0][0].max_completion_tokens).toBe(OUTPUT_TOKEN_FLOOR.openai);
  });

  it("Anthropic 안전 거절(refusal) → 다음 provider로 넘긴다(Haiku 5.5엔 서버 쪽 대체 모델이 없다)", async () => {
    anthropicCreate.mockResolvedValueOnce({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 10, output_tokens: 0 } });
    openaiCreate.mockResolvedValueOnce(openaiOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META, prompt: "JSON 주세요", maxTokens: 100, provider: "anthropic" });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("gpt-6.1-terra");
    expect(isRetryableProviderError(new AnthropicRefusalError(null))).toBe(true);
  });

  it("넘길 회사가 없으면(문서 경로 = Claude 전용) 거절을 한글 안내로 — 영문 원문('refusal: …')을 화면에 내지 않는다", async () => {
    anthropicCreate.mockResolvedValueOnce({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 10, output_tokens: 0 } });
    const run = generateJSON({
      meta: TEST_META,
      prompt: "JSON 주세요",
      maxTokens: 100,
      provider: "anthropic",
      document: { mediaType: "application/pdf", dataBase64: "AA==" },
    });
    await expect(run).rejects.toThrow("AI가 이 내용으로는 글을 쓰지 않았습니다");
    await expect(run).rejects.not.toThrow(/refusal/);
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("이미지 첨부는 Claude 인증 실패여도 OpenAI로 새지 않는다", async () => {
    anthropicCreate.mockRejectedValueOnce({ status: 401, message: "invalid api key" });
    await expect(generateJSON({
      meta: TEST_META, prompt: "JSON 주세요", maxTokens: 100, provider: "anthropic",
      images: [{ mediaType: "image/png", dataBase64: "AA==" }],
    })).rejects.toThrow("AI 키 오류");
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("temperature 미지정이면 deprecated류 400도 재시도 없이 throw", async () => {
    anthropicCreate.mockRejectedValueOnce(
      Object.assign(new Error('400 {"error":{"message":"`temperature` is deprecated for this model."}}'), {
        status: 400,
      }),
    );
    await expect(
      generateJSON({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100, provider: "anthropic" }),
    ).rejects.toThrow();
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});

describe("openAIRequestParams — GPT 요청 규칙과 Claude 프롬프트 동일성", () => {
  const opts = {
    meta: { tenantId: "tenant-test", feature: "notice_translate" },
    prompt: "JSON으로 번역 결과를 주세요",
    system: "입력 사실만 사용한다",
    maxTokens: 900,
    tier: "balanced" as const,
    temperature: 0.3,
    reasoningEffort: "minimal" as const,
  };

  it("temperature·max_tokens 없이 max_completion_tokens·JSON mode·추론 강도를 보낸다", () => {
    const params = openAIRequestParams("gpt-6.1-terra", opts);
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("max_tokens");
    expect(params.max_completion_tokens).toBe(OUTPUT_TOKEN_FLOOR.openai);
    expect(params.response_format).toEqual({ type: "json_object" });
    expect(params.reasoning_effort).toBe("low");
  });

  it("GPT에도 Claude와 같은 system·user 본문을 보낸다(전용 지시문 없음)", () => {
    const claude = anthropicRequestParams("claude-sonnet-5-5", opts, true);
    const gpt = openAIRequestParams("gpt-6.1-terra", opts);
    expect(gpt.messages).toEqual([
      { role: "system", content: claude.system },
      { role: "user", content: claude.messages[0]?.content },
    ]);
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

describe("anthropicRequestParams — 프롬프트 캐시 지점(2026-10-21)", () => {
  const META = { tenantId: "t", feature: "video_review_judge" };
  const IMG = { mediaType: "image/jpeg" as const, dataBase64: "AAAA", label: "f01_00m01s" };
  it("cacheSystem: system이 캐시 표시가 붙은 텍스트 블록 배열로 간다 — 없으면 문자열 그대로", () => {
    const cached = anthropicRequestParams("claude-haiku-5-5", { prompt: "p", system: "s", cacheSystem: true, maxTokens: 10, meta: META }, false);
    expect(cached.system).toEqual([{ type: "text", text: "s", cache_control: { type: "ephemeral" } }]);
    expect(cached.messages[0].content).toBe("p");
    const plain = anthropicRequestParams("claude-haiku-5-5", { prompt: "p", system: "s", maxTokens: 10, meta: META }, false);
    expect(plain.system).toBe("s");
  });
  it("cachePrefix: 첨부 뒤 · prompt 앞에 캐시 표시 블록 하나 — 첨부가 없어도 블록 배열", () => {
    const withImg = anthropicRequestParams("claude-sonnet-5-5", { prompt: "q", cachePrefix: "자료", images: [IMG], maxTokens: 10, meta: META }, false);
    expect(withImg.messages[0].content).toEqual([
      { type: "text", text: "f01_00m01s" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
      { type: "text", text: "자료", cache_control: { type: "ephemeral" } },
      { type: "text", text: "q" },
    ]);
    const noImg = anthropicRequestParams("claude-sonnet-5-5", { prompt: "q", cachePrefix: "자료", maxTokens: 10, meta: META }, false);
    expect(noImg.messages[0].content).toEqual([{ type: "text", text: "자료", cache_control: { type: "ephemeral" } }, { type: "text", text: "q" }]);
  });
  it("anthropicUsage: 캐시 읽기·쓰기 토큰을 따로 든다(input_tokens엔 안 들어 있다)", () => {
    expect(anthropicUsage({ input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 }))
      .toEqual({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 4000, cacheWriteTokens: 0 });
    expect(anthropicUsage(null)).toBeNull();
  });
});
