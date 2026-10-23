import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ audit: vi.fn(), gate: vi.fn(), input: vi.fn(), license: vi.fn(), saved: vi.fn(), claim: vi.fn(), reserve: vi.fn(), finish: vi.fn(), release: vi.fn(), generate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/features/audit/server/log", () => ({ logAction: m.audit }));
vi.mock("./access", () => ({ requireContributionWrite: m.gate }));
vi.mock("./summary-input", () => ({ getSummaryInput: m.input }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: m.license }));
vi.mock("./summary-store", () => ({ readSavedSummary: m.saved, claimSummary: m.claim, finishSummary: m.finish, releaseSummary: m.release, reserveSummaryCall: m.reserve }));
vi.mock("@/lib/ai/generate", () => ({ generateJSON: m.generate }));
vi.mock("@/lib/ai/model-label", () => ({ modelDisplayLabel: () => "Claude" }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
import { generateStudentRecordSummary } from "./summary-actions";
const source = { itemId: "classes:c", text: "고등 영어를 현재 수강하고 있습니다.", date: "2026-10-23" };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY", "test-only");
  m.gate.mockResolvedValue({ tenantId: "t", userId: "owner", canWrite: true });
  m.input.mockResolvedValue({ hash: "hash", sources: [source], asOf: "2026-10-23" });
  m.license.mockResolvedValue(true); m.saved.mockResolvedValue({ ready: true }); m.claim.mockResolvedValue(true);
  m.reserve.mockResolvedValue(true);
  m.generate.mockResolvedValueOnce({ data: { items: [{ itemId: source.itemId, summary: "현재 고등 영어를 수강 중입니다.", excerpt: source.text }] }, model: "test" })
    .mockResolvedValue({ data: { verdicts: [{ itemId: source.itemId, supported: true }] }, model: "test" });
});
afterEach(() => vi.unstubAllEnvs());
it("requires the existing write gate before any AI or storage access", async () => {
  m.gate.mockRejectedValue(new Error("denied"));
  expect((await generateStudentRecordSummary("s")).error).toBeTruthy();
  expect(m.input).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled(); expect(m.claim).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
});
it.each(["source", "license", "key", "schema", "busy"])("blocks generation when %s is unavailable", async (kind) => {
  if (kind === "source") m.input.mockResolvedValue(null);
  if (kind === "license") m.license.mockResolvedValue(false);
  if (kind === "key") vi.stubEnv("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY", "");
  if (kind === "schema") m.saved.mockResolvedValue({ ready: false });
  if (kind === "busy") m.claim.mockResolvedValue(false);
  expect((await generateStudentRecordSummary("s")).error).toBeTruthy(); expect(m.generate).not.toHaveBeenCalled();
});
it("uses Claude only, fast/low, a fixed bundle and saves after evidence validation", async () => {
  expect(await generateStudentRecordSummary("s")).toEqual({ ok: true });
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ tier: "fast", reasoningEffort: "low", allowedProviders: ["anthropic"], meta: { feature: "student_ontology_summary", tenantId: "t" } }));
  expect(m.finish).toHaveBeenCalledOnce(); expect(m.release).toHaveBeenCalledOnce();
  expect(m.generate).toHaveBeenCalledTimes(2); expect(m.reserve).toHaveBeenCalledTimes(2);
  expect(m.input).toHaveBeenLastCalledWith("s", true);
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "student_contribution_summary_generate", metadata: {
    studentId: "s", inputHash: "hash", outcome: "saved", providerRequested: true, itemCount: 1, model: "Claude",
  } }));
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain(source.text);
});
it("does not save a made-up statement even with a valid evidence ID", async () => {
  m.generate.mockReset().mockResolvedValue({ data: { items: [{ itemId: source.itemId, summary: "수학 성적이 대폭 향상되었습니다.", excerpt: "수학 성적이 대폭 향상되었습니다." }] }, model: "test" });
  expect((await generateStudentRecordSummary("s")).error).toBeTruthy(); expect(m.finish).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ outcome: "failed", providerRequested: true }) }));
});
it("does not save when source evidence changes during generation", async () => {
  m.input.mockResolvedValueOnce({ hash: "old", sources: [source], asOf: "2026-10-23" }).mockResolvedValueOnce({ hash: "new", sources: [source] });
  expect((await generateStudentRecordSummary("s")).error).toContain("바뀌었습니다"); expect(m.finish).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
});
it("releases the lease on provider failure", async () => {
  m.generate.mockReset().mockRejectedValue(new Error("provider offline"));
  expect((await generateStudentRecordSummary("s")).error).toBeTruthy(); expect(m.release).toHaveBeenCalledOnce(); expect(m.finish).not.toHaveBeenCalled();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ failureStage: "generation", failureCode: "generation_failed" }) }));
});
it("records validation failure separately without leaking the generated body", async () => {
  m.generate.mockReset().mockResolvedValue({ data: { items: [{ itemId: source.itemId, summary: "원본에 없는 사적인 내용입니다.", excerpt: "원본에 없는 사적인 내용입니다." }] } });
  const response = await generateStudentRecordSummary("s");
  expect(response.error).toContain("확인을 통과하지 못했습니다");
  expect(m.generate).toHaveBeenCalledTimes(2); expect(m.finish).not.toHaveBeenCalled();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ failureStage: "generation", failureCode: "invalid_response" }) }));
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain("사적인 내용");
});
it("distinguishes saving errors while retaining the previous result", async () => {
  m.finish.mockRejectedValue(new Error("database detail must stay private"));
  expect((await generateStudentRecordSummary("s")).error).toContain("저장하지 못했습니다");
  expect(m.release).toHaveBeenCalledOnce();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ failureStage: "save", failureCode: "storage_failed" }) }));
  expect(JSON.stringify(m.audit.mock.calls)).not.toContain("database detail");
});
it("stops before the provider when the tenant allowance is exhausted", async () => {
  m.reserve.mockResolvedValue(false);
  expect((await generateStudentRecordSummary("s")).error).toContain("한도");
  expect(m.generate).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ outcome: "quota", providerRequested: false }) }));
});
it("bounds the input before reserving or calling the provider", async () => {
  m.input.mockResolvedValue({ hash: "h", asOf: "2026-10-23", sources: [{ ...source, text: "가".repeat(9000) }] });
  expect((await generateStudentRecordSummary("s")).error).toBeTruthy();
  expect(m.reserve).not.toHaveBeenCalled(); expect(m.generate).not.toHaveBeenCalled(); expect(m.release).toHaveBeenCalledOnce();
});
