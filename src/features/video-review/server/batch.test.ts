import { beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_BLOCKED_MESSAGE } from "@/lib/license/rule";

const fakes = vi.hoisted(() => ({
  submitJSONBatch: vi.fn(),
  claimRows: vi.fn(),
  moveStage: vi.fn(),
  failOrRetry: vi.fn(),
  loadMaterial: vi.fn(),
  aiAnalysisEnabled: vi.fn(),
}));

vi.mock("@/lib/ai/generate-batch", () => ({
  collectJSONBatch: vi.fn(),
  submitJSONBatch: fakes.submitJSONBatch,
}));
vi.mock("@/lib/observability/report-error", () => ({ reportWarning: vi.fn() }));
vi.mock("./finalize", () => ({ finalizeReview: vi.fn() }));
vi.mock("./material", () => ({ loadMaterial: fakes.loadMaterial, materialBytes: () => 1 }));
vi.mock("./requests", () => ({
  judgeRequest: () => ({ meta: { tenantId: "tenant", feature: "video_review_judge" } }),
  verifyRequest: () => ({ meta: { tenantId: "tenant", feature: "video_review_verify" } }),
}));
vi.mock("./rows", () => ({
  REVIEW_COLUMNS: "id",
  aiAnalysisEnabled: fakes.aiAnalysisEnabled,
  claimRows: fakes.claimRows,
  moveStage: fakes.moveStage,
  failOrRetry: fakes.failOrRetry,
  errorText: (e: unknown) => String(e),
  db: vi.fn(),
}));

import { submitJudgeBatch, submitVerifyBatch } from "./batch";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  tenant_id: "tenant",
  stage: "judging",
  attempts: 2,
  models: {},
  judge: { mistakes: [{ where: "1:00", why_wrong: "틀림" }] },
};

describe("영상 AI 메모 배치 제출 거절", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakes.moveStage.mockResolvedValue(true);
    fakes.loadMaterial.mockResolvedValue({});
    fakes.aiAnalysisEnabled.mockResolvedValue(true);
  });

  it("AI 분석이 이미 꺼졌으면 줄을 선점하지 않는다", async () => {
    fakes.aiAnalysisEnabled.mockResolvedValue(false);

    await expect(submitJudgeBatch("tenant")).resolves.toBe(0);
    await expect(submitVerifyBatch("tenant")).resolves.toBe(0);

    expect(fakes.claimRows).not.toHaveBeenCalled();
    expect(fakes.submitJSONBatch).not.toHaveBeenCalled();
  });

  it("판정 배치가 AI 라이선스로 거절되면 시도 횟수 없이 judge로 돌린다", async () => {
    fakes.claimRows.mockResolvedValue({ token: "lock", rows: [row] });
    fakes.submitJSONBatch.mockResolvedValue({ batchId: "", models: {}, rejected: [
      { customId: "j_11111111111111111111111111111111", error: LICENSE_BLOCKED_MESSAGE.ai_analysis },
    ] });

    await expect(submitJudgeBatch("tenant")).resolves.toBe(0);

    expect(fakes.failOrRetry).not.toHaveBeenCalled();
    expect(fakes.moveStage).toHaveBeenCalledWith(
      row,
      "judging",
      { stage: "judge", lock_token: null, locked_at: null, error: LICENSE_BLOCKED_MESSAGE.ai_analysis },
      { lock_token: "lock" },
    );
  });

  it("확인 배치가 AI 라이선스로 거절되면 시도 횟수 없이 verify로 돌린다", async () => {
    fakes.claimRows.mockResolvedValue({ token: "lock", rows: [{ ...row, stage: "verifying" }] });
    fakes.submitJSONBatch.mockResolvedValue({ batchId: "", models: {}, rejected: [
      { customId: "v_11111111111111111111111111111111_0", error: LICENSE_BLOCKED_MESSAGE.ai_analysis },
    ] });

    await expect(submitVerifyBatch("tenant")).resolves.toBe(0);

    expect(fakes.failOrRetry).not.toHaveBeenCalled();
    expect(fakes.moveStage).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id }),
      "verifying",
      { stage: "verify", lock_token: null, locked_at: null, error: LICENSE_BLOCKED_MESSAGE.ai_analysis },
      { lock_token: "lock" },
    );
  });

  it("판정 배치의 일반 거절은 종전 재시도 횟수에 포함한다", async () => {
    fakes.claimRows.mockResolvedValue({ token: "lock", rows: [row] });
    fakes.submitJSONBatch.mockResolvedValue({ batchId: "", models: {}, rejected: [
      { customId: "j_11111111111111111111111111111111", error: "429 Too Many Requests" },
    ] });

    await expect(submitJudgeBatch("tenant")).resolves.toBe(0);

    expect(fakes.moveStage).not.toHaveBeenCalled();
    expect(fakes.failOrRetry).toHaveBeenCalledWith(row, "judge", "429 Too Many Requests", 3, { lock_token: "lock" });
  });

  it("확인 배치 제출 예외도 일반 오류면 종전 재시도 횟수에 포함한다", async () => {
    const verifying = { ...row, stage: "verifying" };
    fakes.claimRows.mockResolvedValue({ token: "lock", rows: [verifying] });
    fakes.submitJSONBatch.mockRejectedValue(new Error("잔액 부족"));

    await expect(submitVerifyBatch("tenant")).resolves.toBe(0);

    expect(fakes.moveStage).not.toHaveBeenCalled();
    expect(fakes.failOrRetry).toHaveBeenCalledWith(verifying, "verify", "확인 배치 보내기 실패: Error: 잔액 부족", 3, { lock_token: "lock" });
  });

  it("제출 사이에 AI 분석이 꺼지면 일반 오류도 횟수 없이 되돌린다", async () => {
    fakes.aiAnalysisEnabled.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fakes.claimRows.mockResolvedValue({ token: "lock", rows: [row] });
    fakes.submitJSONBatch.mockRejectedValue(new Error("일시 오류"));

    await expect(submitJudgeBatch("tenant")).resolves.toBe(0);

    expect(fakes.failOrRetry).not.toHaveBeenCalled();
    expect(fakes.moveStage).toHaveBeenCalledWith(
      row,
      "judging",
      { stage: "judge", lock_token: null, locked_at: null, error: "판정 배치 보내기 실패: Error: 일시 오류" },
      { lock_token: "lock" },
    );
  });
});
