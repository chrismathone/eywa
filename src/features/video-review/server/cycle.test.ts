import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  videoReviewEnabled: vi.fn(),
  aiAnalysisEnabled: vi.fn(),
  enqueueNewVideos: vi.fn(),
  submitTranscriptions: vi.fn(),
  reconcileTranscriptions: vi.fn(),
  collectJudgeBatches: vi.fn(),
  collectVerifyBatches: vi.fn(),
  submitJudgeBatch: vi.fn(),
  submitVerifyBatch: vi.fn(),
}));

vi.mock("@/lib/ai/dev-cli", () => ({ devCliEnabled: () => false }));
vi.mock("@/lib/observability/report-error", () => ({ reportWarning: vi.fn() }));
vi.mock("./queue", () => ({ enqueueNewVideos: fakes.enqueueNewVideos }));
vi.mock("./transcribe", () => ({
  reconcileTranscriptions: fakes.reconcileTranscriptions,
  submitTranscriptions: fakes.submitTranscriptions,
}));
vi.mock("./batch", () => ({
  collectJudgeBatches: fakes.collectJudgeBatches,
  collectVerifyBatches: fakes.collectVerifyBatches,
  submitJudgeBatch: fakes.submitJudgeBatch,
  submitVerifyBatch: fakes.submitVerifyBatch,
}));
vi.mock("./rows", () => ({
  aiAnalysisEnabled: fakes.aiAnalysisEnabled,
  videoReviewEnabled: fakes.videoReviewEnabled,
  errorText: (e: unknown) => String(e),
  db: () => {
    const q = {
      select() { return this; },
      eq() { return this; },
      is() { return this; },
      lt() { return this; },
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return { from: () => q };
  },
}));

import { runVideoReviewCycle } from "./cycle";

describe("영상 AI 메모 주기 라이선스", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.videoReviewEnabled.mockResolvedValue(true);
    fakes.aiAnalysisEnabled.mockResolvedValue(true);
    for (const fn of [
      fakes.enqueueNewVideos,
      fakes.submitTranscriptions,
      fakes.reconcileTranscriptions,
      fakes.collectJudgeBatches,
      fakes.collectVerifyBatches,
      fakes.submitJudgeBatch,
      fakes.submitVerifyBatch,
    ]) fn.mockResolvedValue(0);
  });

  it("AI 분석이 꺼지면 새 작업은 내지 않고 이미 제출한 전사·배치만 수거한다", async () => {
    fakes.aiAnalysisEnabled.mockResolvedValue(false);

    await runVideoReviewCycle("tenant", new Date("2026-11-12T13:00:00Z"));

    expect(fakes.enqueueNewVideos).not.toHaveBeenCalled();
    expect(fakes.submitTranscriptions).not.toHaveBeenCalled();
    expect(fakes.submitJudgeBatch).not.toHaveBeenCalled();
    expect(fakes.submitVerifyBatch).not.toHaveBeenCalled();
    expect(fakes.reconcileTranscriptions).toHaveBeenCalledWith("tenant");
    expect(fakes.collectJudgeBatches).toHaveBeenCalledWith("tenant");
    expect(fakes.collectVerifyBatches).toHaveBeenCalledWith("tenant");
  });

  it("침산 조건처럼 두 라이선스가 켜져 있으면 종전 제출·수거 흐름을 모두 돈다", async () => {
    await runVideoReviewCycle("cs", new Date("2026-11-12T13:00:00Z"));

    expect(fakes.enqueueNewVideos).toHaveBeenCalledWith("cs");
    expect(fakes.submitTranscriptions).toHaveBeenCalledWith("cs", undefined);
    expect(fakes.reconcileTranscriptions).toHaveBeenCalledWith("cs");
    expect(fakes.collectJudgeBatches).toHaveBeenCalledWith("cs");
    expect(fakes.collectVerifyBatches).toHaveBeenCalledWith("cs");
    expect(fakes.submitVerifyBatch).toHaveBeenCalledWith("cs");
    expect(fakes.submitJudgeBatch).toHaveBeenCalledWith("cs");
  });
});
