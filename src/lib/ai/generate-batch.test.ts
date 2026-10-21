import { describe, expect, it, vi } from "vitest";

// 배치 모듈은 Anthropic 클라이언트·라이선스를 끌어온다 — 여기서는 순수 변환(devInput)만 본다.
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: async () => true }));
vi.mock("./anthropic", () => ({ getAnthropic: () => ({}) }));

import { devInput } from "./generate-batch";
import { anthropicRequestParams } from "./generate";

const META = { tenantId: "t", feature: "video_review_verify" };
const IMG = { mediaType: "image/jpeg" as const, dataBase64: "AAAA", label: "f01_00m01s" };

describe("devInput — 캐시 지점이 있어도 개발 CLI엔 글이 빠짐없이 간다", () => {
  it("system 블록 배열(cacheSystem)은 글로 풀고, cachePrefix 글은 prompt 앞에 차례대로 잇는다", () => {
    const params = anthropicRequestParams("claude-sonnet-5-5", {
      prompt: "[받은 주장] x", cachePrefix: "[전사] 자료", system: "지침", cacheSystem: true, images: [IMG], maxTokens: 100, meta: META,
    }, false);
    const input = devInput(params);
    expect(input.system).toBe("지침");
    expect(input.images).toEqual([{ mediaType: "image/jpeg", dataBase64: "AAAA", label: "f01_00m01s" }]);
    expect(input.prompt).toBe("[전사] 자료\n[받은 주장] x");
  });
  it("캐시 표시가 없으면 전과 같다", () => {
    const input = devInput(anthropicRequestParams("claude-haiku-5-5", { prompt: "p", system: "s", maxTokens: 100, meta: META }, false));
    expect(input).toEqual({ model: "claude-haiku-5-5", prompt: "p", system: "s", images: [] });
  });
});
