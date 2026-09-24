import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * generateJSON의 **지점 라이선스 관문** — 원장 2026-09-25 *"빈틈 매꿀것"*: 지점을 모르는 호출이 판정을 건너뛰고
 * 꺼진 지점에서도 AI가 나가던 틈을 닫았다. 여기서 보는 것 두 가지:
 *  ① 지점이 비면 거절(라이선스도 provider도 안 부른다)  ② 라이선스가 꺼졌으면 거절(provider를 안 부른다).
 */
const { anthropicCreate, licensed } = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  licensed: vi.fn(),
}));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: licensed }));
vi.mock("./anthropic", () => ({ getAnthropic: () => ({ messages: { create: anthropicCreate } }) }));

import { generateJSON } from "./generate";
import { AI_TENANT_MISSING_MESSAGE, LICENSE_BLOCKED_MESSAGE } from "@/lib/license/rule";
import { aiUserMessage } from "./user-message";

beforeEach(() => {
  anthropicCreate.mockReset();
  licensed.mockReset();
  process.env.AI_PROVIDER = "anthropic";
  process.env.ANTHROPIC_API_KEY = "a";
});

describe("generateJSON 지점 라이선스 관문", () => {
  it("지점이 비면 거절 — 라이선스 조회도 provider 호출도 없다", async () => {
    for (const tenantId of ["", "   ", undefined as unknown as string, null as unknown as string]) {
      await expect(
        generateJSON({ prompt: "JSON", maxTokens: 10, provider: "anthropic", meta: { tenantId, feature: "x" } }),
      ).rejects.toThrow(AI_TENANT_MISSING_MESSAGE);
    }
    expect(licensed).not.toHaveBeenCalled();
    expect(anthropicCreate).not.toHaveBeenCalled();
    // 화면에는 그대로 간다(일반 실패 문구로 덮이지 않는다).
    expect(aiUserMessage(new Error(AI_TENANT_MISSING_MESSAGE), "실패")).toBe(AI_TENANT_MISSING_MESSAGE);
  });

  it("라이선스가 꺼진 지점은 거절 — provider를 부르지 않는다", async () => {
    licensed.mockResolvedValue(false);
    await expect(
      generateJSON({ prompt: "JSON", maxTokens: 10, provider: "anthropic", meta: { tenantId: "t-off", feature: "x" } }),
    ).rejects.toThrow(LICENSE_BLOCKED_MESSAGE.ai_analysis);
    expect(licensed).toHaveBeenCalledWith("t-off", "ai_analysis");
    expect(anthropicCreate).not.toHaveBeenCalled();
  });

  it("켜진(또는 행이 없는) 지점은 그대로 호출된다", async () => {
    licensed.mockResolvedValue(true);
    anthropicCreate.mockResolvedValueOnce({ content: [{ type: "text", text: '{"ok":true}' }], usage: {} });
    const { data } = await generateJSON<{ ok: boolean }>({
      prompt: "JSON",
      maxTokens: 10,
      provider: "anthropic",
      meta: { tenantId: "t-on", feature: "x" },
    });
    expect(data).toEqual({ ok: true });
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
  });
});
