import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK 클라이언트 모킹 — 실제 네트워크 없이 generateJSON 폴백 경로를 결정적으로 검증.
const { upstageCreate, anthropicCreate } = vi.hoisted(() => ({
  upstageCreate: vi.fn(),
  anthropicCreate: vi.fn(),
}));
// 지점 라이선스 조회는 DB를 부른다 — 이 파일은 provider 동작만 보므로 늘 허용으로 둔다(라이선스 자체는 license.test.ts).
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
const TEST_META = { tenantId: "tenant-test", feature: "test" };

vi.mock("./upstage", () => ({
  getUpstage: () => ({ chat: { completions: { create: upstageCreate } } }),
}));
vi.mock("./anthropic", () => ({
  getAnthropic: () => ({ messages: { create: anthropicCreate } }),
}));

import {
  AnthropicRefusalError,
  CLAUDE5_MIN_MAX_TOKENS,
  generateJSON,
  isClaude5Model,
  isCreditExhaustedError,
  isRetryableProviderError,
  isTemperatureDeprecatedError,
  parseJsonLoose,
} from "./generate";
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

  it("provider마다 모양이 다르다 — DeepSeek 402·잔액 문구·OpenAI 호환 quota", () => {
    expect(isCreditExhaustedError({ status: 402 })).toBe(true); // DeepSeek Payment Required
    expect(isCreditExhaustedError(new Error("Insufficient Balance"))).toBe(true);
    expect(isRetryableProviderError(new Error('{"code":"insufficient_quota"}'))).toBe(true);
    expect(isRetryableProviderError(new Error("You exceeded your current quota, please check your plan"))).toBe(true);
  });

  it("잔액과 무관한 400/5xx·파싱 실패는 그대로 폴백 안 함(오탐 금지)", () => {
    expect(isCreditExhaustedError({ status: 400, message: "bad request" })).toBe(false);
    expect(isCreditExhaustedError(new Error("JSON parse error"))).toBe(false);
    expect(isCreditExhaustedError({ status: 500 })).toBe(false);
    expect(isRetryableProviderError({ status: 400, message: "bad request" })).toBe(false);
  });
});

describe("폴백 사다리 = anthropic → deepseek → upstage(Solar)", () => {
  // 원장 2026-08-28: "anthropic -> deepseek", "deepseek 소진시 solar 폴백".
  const KEYS = [
    "AI_PROVIDER",
    "ANTHROPIC_API_KEY",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_API_KEY_CONSULTATIONS",
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

  it("🔴 Anthropic이 기본이면 다음은 DeepSeek, Solar는 마지막", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "an";
    process.env.DEEPSEEK_API_KEY = "ds";
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["anthropic", "deepseek", "upstage"]);
    expect(resolveModelChain("balanced").map((c) => c.provider)).toEqual(["anthropic", "deepseek", "upstage"]);
  });

  it("DeepSeek 키가 없으면 Solar로 건너뛴다(무중단)", () => {
    process.env.AI_PROVIDER = "anthropic";
    process.env.ANTHROPIC_API_KEY = "an";
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["anthropic", "upstage"]);
  });

  it("기본이 Solar여도 그 다음은 Anthropic → DeepSeek 순", () => {
    process.env.ANTHROPIC_API_KEY = "an";
    process.env.DEEPSEEK_API_KEY = "ds";
    process.env.UPSTAGE_API_KEY = "up";
    expect(resolveModelChain("fast").map((c) => c.provider)).toEqual(["upstage", "anthropic", "deepseek"]);
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
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("claude-sonnet-5");
    expect(upstageCreate).toHaveBeenCalledOnce();
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  it("upstage 성공 시 anthropic 호출 안 함", async () => {
    upstageCreate.mockResolvedValueOnce(upstageOk('{"x":1}'));
    const { data } = await generateJSON<{ x: number }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ x: 1 });
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("🔴 크레딧 소진(400)도 다음 provider로 폴백한다 — 2026-08-27 사고의 정확한 재현", async () => {
    upstageCreate.mockRejectedValueOnce(
      Object.assign(
        new Error(
          '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}',
        ),
        { status: 400 },
      ),
    );
    anthropicCreate.mockResolvedValueOnce(anthropicOk('{"ok":true}'));
    const { data } = await generateJSON<{ ok: boolean }>({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 });
    expect(data).toEqual({ ok: true }); // 종전엔 여기서 throw → 호출부가 폴백 템플릿으로 떨어졌다
    expect(anthropicCreate).toHaveBeenCalledOnce();
  });

  it("폴백 불가 오류(400)는 즉시 throw, 다음 provider 시도 안 함", async () => {
    upstageCreate.mockRejectedValueOnce({ status: 400, message: "bad request" });
    await expect(generateJSON({ meta: TEST_META,  prompt: "JSON 주세요", maxTokens: 100 })).rejects.toThrow();
    expect(anthropicCreate).not.toHaveBeenCalled();
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
    expect(model).toBe("claude-sonnet-5");
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(anthropicCreate.mock.calls[0][0]).not.toHaveProperty("temperature");
    // 생각 토큰이 상한을 먹지 않게 바닥을 올린다(쓴 만큼만 과금).
    expect(anthropicCreate.mock.calls[0][0].max_tokens).toBe(CLAUDE5_MIN_MAX_TOKENS);
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
    expect(params.max_tokens).toBe(CLAUDE5_MIN_MAX_TOKENS);
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
    expect(upstageCreate).not.toHaveBeenCalled();
  });

  it("isClaude5Model — 5 계열만(4.x·날짜 접미 없는 ID)", () => {
    for (const m of ["claude-haiku-5-5", "claude-sonnet-5", "claude-sonnet-5-5", "claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-mythos-5-1"])
      expect(isClaude5Model(m), m).toBe(true);
    for (const m of ["claude-haiku-4-5", "claude-opus-4-7", "claude-sonnet-4-6", "deepseek-v4-flash", "solar-pro3"])
      expect(isClaude5Model(m), m).toBe(false);
  });

  it("Anthropic 안전 거절(refusal) → 다음 provider로 넘긴다(Haiku 5.5엔 서버 쪽 대체 모델이 없다)", async () => {
    anthropicCreate.mockResolvedValueOnce({ content: [], stop_reason: "refusal", stop_details: { category: "cyber" }, usage: { input_tokens: 10, output_tokens: 0 } });
    upstageCreate.mockResolvedValueOnce(upstageOk('{"ok":true}'));
    const { data, model } = await generateJSON<{ ok: boolean }>({ meta: TEST_META, prompt: "JSON 주세요", maxTokens: 100, provider: "anthropic" });
    expect(data).toEqual({ ok: true });
    expect(model).toBe("solar-pro3");
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
