import { describe, expect, it, vi } from "vitest";

import type { DevCliInput } from "./dev-cli";

// 개발 CLI 즉시 경로 — 이 파일만 dev-cli를 '켜짐'으로 모킹한다(generate.test.ts는 평소 경로를 본다).
const { runDevCli, runCodexCli } = vi.hoisted(() => ({
  runDevCli: vi.fn<(input: DevCliInput) => Promise<string>>(async () => '{"ok":true}'),
  runCodexCli: vi.fn(async () => '{"ok":true}'),
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("./dev-cli", () => ({ devCliEnabled: () => true, runDevCli, runCodexCli }));
vi.mock("./anthropic", () => ({ getAnthropic: () => ({ messages: { create: vi.fn() } }) }));

import { FACT_GUARD } from "./fact-guard";
import { generateJSON, textPrompt } from "./generate";

describe("개발 CLI 즉시 경로 — cachePrefix(확인 자료)가 CLI 본문에서 빠지지 않는다(적대 리뷰 2026-10-21)", () => {
  it("prompt 앞에 cachePrefix를 잇고 그 앞에 사실 원칙이 붙는다 · system은 그대로", async () => {
    await generateJSON({
      prompt: "[받은 주장] x", cachePrefix: "[전사] 자료", system: "지침", cacheSystem: true, provider: "anthropic",
      images: [{ mediaType: "image/jpeg", dataBase64: "AAAA", label: "f01" }], maxTokens: 100, meta: { tenantId: "t", feature: "video_review_verify" },
    });
    expect(runDevCli).toHaveBeenCalledTimes(1);
    const arg = runDevCli.mock.calls[0][0];
    expect(arg.system).toBe("지침");
    expect(arg.images).toHaveLength(1);
    // 차례 = 캐시 글(자료) → 사실 원칙 → 주장: 사실 원칙은 prompt에 붙고(withFactGuard), 캐시 글은 그 앞에 잇는다(배치 devInput·API 본문과 같은 차례).
    expect(arg.prompt.startsWith("[전사] 자료\n\n")).toBe(true);
    const guardAt = arg.prompt.indexOf(FACT_GUARD);
    expect(guardAt).toBeGreaterThan(0);
    expect(guardAt).toBeLessThan(arg.prompt.indexOf("[받은 주장] x"));
  });
  it("textPrompt — 캐시 글이 없으면 prompt 그대로", () => {
    expect(textPrompt({ prompt: "p" })).toBe("p");
    expect(textPrompt({ prompt: "p", cachePrefix: "c" })).toBe("c\n\np");
  });
  it("첫 후보가 OpenAI면 기능 표의 모델·추론 강도로 Codex 내부요금제를 쓴다", async () => {
    const beforeAnthropic = process.env.ANTHROPIC_API_KEY;
    const beforeOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test";
    try {
      await generateJSON({
        prompt: "JSON으로 답해라", maxTokens: 100, tier: "fast", provider: "openai",
        meta: { tenantId: "t", feature: "classnote_ment" },
      });
      expect(runCodexCli).toHaveBeenCalledWith(expect.objectContaining({
        model: "gpt-6-luna", reasoningEffort: "low",
      }));
    } finally {
      if (beforeAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = beforeAnthropic;
      if (beforeOpenAI === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = beforeOpenAI;
    }
  });
});
