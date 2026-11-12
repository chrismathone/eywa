import { describe, expect, it } from "vitest";
import {
  cliEnv,
  codexCliEnv,
  codexCliInvocation,
  devCliEnabled,
  devCliPrompt,
  parseCliEnvelope,
  parseCodexJsonl,
  summarizeCodexCliError,
} from "./dev-cli";

describe("개발 전용 Claude CLI 갈래", () => {
  it("🔴 운영·Vercel에서는 절대 켜지지 않는다", () => {
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development" })).toBe(true);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "production" })).toBe(false);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development", VERCEL: "1" })).toBe(false);
    expect(devCliEnabled({ AI_DEV_CLAUDE_CLI: "1", NODE_ENV: "development", VERCEL_ENV: "preview" })).toBe(false);
    expect(devCliEnabled({ NODE_ENV: "development" })).toBe(false);
  });
  it("🔴 CLI에는 Anthropic 키를 넘기지 않는다(요금제 로그인으로만 돈다)", () => {
    const env = cliEnv({ ANTHROPIC_API_KEY: "k", ANTHROPIC_API_KEY_VIDEO: "g", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
  it("🔴 Codex CLI에는 OpenAI 키를 넘기지 않는다(요금제 로그인으로만 돈다)", () => {
    const env = codexCliEnv({ OPENAI_API_KEY: "k", OPENAI_BASE_URL: "https://example.invalid", PATH: "/bin" });
    expect(env).toEqual({ PATH: "/bin" });
  });
  it("Windows 기본값은 npm codex.cmd이고 명시한 실행 파일은 그대로 따른다", () => {
    expect(codexCliInvocation({ ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32")).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      prefixArgs: ["/d", "/s", "/c", "codex.cmd"],
      binary: "codex.cmd",
    });
    expect(codexCliInvocation({ AYWA_CODEX_BIN: "C:\\tools\\codex.exe" }, "win32")).toEqual({
      command: "C:\\tools\\codex.exe",
      prefixArgs: [],
      binary: "C:\\tools\\codex.exe",
    });
    expect(codexCliInvocation({ AYWA_CODEX_BIN: "C:\\tools with space\\codex.cmd" }, "win32")).toMatchObject({
      command: "cmd.exe",
      prefixArgs: ["/d", "/s", "/c", "C:\\tools with space\\codex.cmd"],
    });
    expect(codexCliInvocation({}, "linux")).toEqual({ command: "codex", prefixArgs: [], binary: "codex" });
  });
  it("Codex 실패는 rmcp 경고 대신 마지막 ERROR 원인을 보여 준다", () => {
    expect(summarizeCodexCliError([
      "WARN rmcp::transport: 연결 경고",
      "ERROR: 첫 오류",
      "rmcp::client 경고",
      "ERROR: {\"error\":{\"code\":\"model_not_found\",\"message\":\"gpt-6-luna 미지원\"}}",
    ].join("\n"))).toBe('ERROR: {"error":{"code":"model_not_found","message":"gpt-6-luna 미지원"}}');
  });
  it("화면 파일 경로와 이름을 프롬프트에 싣는다", () => {
    const p = devCliPrompt({ model: "m", prompt: "판정", system: "지침" }, [{ label: "f01_00m05s", path: "/tmp/a.jpg" }]);
    expect(p).toContain("[시스템 지침]\n지침");
    expect(p).toContain("f01_00m05s: /tmp/a.jpg");
    expect(p).toContain("JSON 하나만");
  });
  it("시험 관찰자용 JSON 봉투 — 답 글과 실제로 답한 모델을 꺼낸다", () => {
    const out = JSON.stringify({
      is_error: false, result: '{"a":2}', duration_ms: 4872, total_cost_usd: 0.0077,
      usage: { input_tokens: 2, output_tokens: 104, cache_read_input_tokens: 17001, cache_creation_input_tokens: 37406 },
      modelUsage: { "claude-haiku-5-5": { canonicalModel: "claude-haiku-5-5" } },
    });
    const { text, trace } = parseCliEnvelope(out, "claude-haiku-5-5");
    expect(text).toBe('{"a":2}');
    expect(trace).toMatchObject({ requestedModel: "claude-haiku-5-5", models: ["claude-haiku-5-5"], durationMs: 4872, outputTokens: 104, cacheReadTokens: 17001 });
  });
  it("오류 봉투는 답으로 넘기지 않는다", () => {
    expect(() => parseCliEnvelope(JSON.stringify({ is_error: true, result: "rate limited", api_error_status: 429 }), "m")).toThrow("429");
    expect(() => parseCliEnvelope(JSON.stringify({ is_error: false }), "m")).toThrow();
  });
  it("Codex JSONL에서 모델·토큰 기록을 꺼낸다", () => {
    const trace = parseCodexJsonl([
      JSON.stringify({ type: "thread.started", thread_id: "t" }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 7 } }),
    ].join("\n"), "gpt-6-luna", 1234, "codex-cli 0.167.1");
    expect(trace).toMatchObject({ models: ["gpt-6-luna"], cliVersion: "codex-cli 0.167.1", durationMs: 1234, inputTokens: 11, cacheReadTokens: 3, outputTokens: 7 });
  });
});
