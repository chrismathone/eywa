// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { callJev, JEV_MODEL, JevError, parseJevResponse } from "./jev";
const questions = { attendance: { type: "choice" as const, instructions: "Decide", criteria: { absence: "Absent", none: "No notice" } } };
const response = () => ({ model: JEV_MODEL, answers: { attendance: { type: "choice", choice: "absence", confidence: 0.95, probabilities: { absence: 0.99, none: 0.01 } } }, usage: { input_tokens: 150, output_tokens: 10 } });
afterEach(() => vi.unstubAllGlobals());

describe("Jev response boundary", () => {
  it("retains validated answers and usage", () => {
    expect(parseJevResponse(response(), questions)).toMatchObject({ model: JEV_MODEL, data: { attendance: { choice: "absence" } }, usage: { inputTokens: 150 } });
  });
  it.each([
    { ...response(), answers: {} },
    { ...response(), model: "jev-latest" },
    ...[
      { choice: "invented" }, { type: "noul" }, { confidence: 1.1 }, { confidence: NaN },
      { probabilities: { absence: 0.9 } }, { probabilities: { absence: 0.3, none: 0.2 } },
      { probabilities: { absence: -0.1, none: 1.1 } }, { probabilities: { absence: 0.1, none: 0.9 } },
    ].map((patch) => ({ ...response(), answers: { attendance: { ...response().answers.attendance, ...patch } } })),
  ])("rejects missing, invented or inconsistent answers", (raw) => {
    expect(() => parseJevResponse(raw, questions)).toThrow(JevError);
  });
  it("preserves token accounting even for invalid answers", () => {
    try { parseJevResponse({ ...response(), answers: {} }, questions); }
    catch (error) { expect((error as JevError).usage?.inputTokens).toBe(150); return; }
    throw new Error("Expected rejection");
  });
});

describe("Jev transport", () => {
  it("pins endpoint/model, disables redirect/cache and sends the supplied state", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response())));
    vi.stubGlobal("fetch", fetchMock);
    await callJev({ questions, state: { latest: "결석해요" }, apiKey: "test-only-key" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(JSON.parse(init.body)).toMatchObject({ model: JEV_MODEL, state: { latest: "결석해요" } });
  });
  it("never echoes error response bodies or retries failed requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("private child text test-only-key", { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(callJev({ questions, state: "x", apiKey: "test-only-key" })).rejects.toThrow(/^Jev HTTP 429$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("aborts a hanging request", async () => {
    vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new Error("private transport details")));
    })));
    await expect(callJev({ questions, state: "x", apiKey: "test-only-key", timeoutMs: 10 })).rejects.toThrow("Jev 응답 시간 초과");
  });
  it("blocks oversized inputs before fetch", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(callJev({ questions, state: "한".repeat(50_000), apiKey: "test-only-key" })).rejects.toThrow("입력이 너무 큽니다");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
