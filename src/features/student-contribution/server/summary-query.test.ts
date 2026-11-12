import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ gate: vi.fn(), context: vi.fn(), input: vi.fn(), saved: vi.fn(), licensed: vi.fn() }));
vi.mock("./access", () => ({ getContributionGate: m.gate }));
vi.mock("./live-context", () => ({ getLiveContext: m.context }));
vi.mock("./summary-input", () => ({ getSummaryInput: m.input }));
vi.mock("./summary-store", () => ({ readSavedSummary: m.saved }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: m.licensed }));
import { SUMMARY_VERSION, LEGACY_SUMMARY_VERSION } from "@/features/students/ontology/summary";
import { getStudentRecordSummary } from "./summary-query";
const source = { itemId: "consultations:1", section: "상담", text: "학생이 영어를 계속 배우고 싶다고 말했다.", evidence: [{ href: "/consultations/1" }] };
const row = { input_hash: "hash", contract_version: SUMMARY_VERSION, result: { items: [{ itemId: source.itemId, summary: "상담 당시 학생은 영어를 계속 배우고 싶다고 했습니다.", excerpt: source.text }] }, generated_at: "2026-10-23", model_label: "Claude" };
beforeEach(() => {
  vi.resetAllMocks(); m.gate.mockResolvedValue({ tenantId: "t", userId: "u", canWrite: true }); m.context.mockResolvedValue({ studentId: "s" });
  m.licensed.mockResolvedValue(true);
  m.input.mockResolvedValue({ hash: "hash", sources: [source], partial: false }); m.saved.mockResolvedValue({ ready: true, row });
});
it("only loads this tenant/student/requester's saved result", async () => {
  expect((await getStudentRecordSummary("s"))?.items[0]?.excerpt).toBe(source.text);
  expect(m.saved).toHaveBeenCalledWith({ tenant: "t", studentId: "s", userId: "u" });
});
it("does not read saved content after source access is revoked", async () => {
  m.context.mockResolvedValue(null); expect(await getStudentRecordSummary("s")).toBeNull(); expect(m.saved).not.toHaveBeenCalled();
});
it("AI 분석 라이선스가 꺼지면 저장된 요약도 읽지 않는다", async () => {
  m.licensed.mockResolvedValue(false);
  expect(await getStudentRecordSummary("s")).toBeNull();
  expect(m.saved).not.toHaveBeenCalled();
});
it("does not display old summaries after source changes", async () => {
  m.input.mockResolvedValue({ hash: "changed", sources: [] });
  expect(await getStudentRecordSummary("s")).toMatchObject({ state: "stale", items: [], generatedAt: null, model: null });
});
it("does not display unvalidated stored claims with a matching fingerprint", async () => {
  m.saved.mockResolvedValue({ ready: true, row: { ...row, result: { items: [{ itemId: source.itemId, excerpt: "학생의 모든 학습 문제가 해결되었다." }] } } });
  expect(await getStudentRecordSummary("s")).toMatchObject({ state: "unavailable", items: [] });
});
it("hides the feature until its storage is installed", async () => {
  m.saved.mockResolvedValue({ ready: false }); expect(await getStudentRecordSummary("s")).toBeNull(); expect(m.input).not.toHaveBeenCalled();
});
it("keeps previously saved extracts readable using their original input contract", async () => {
  m.saved.mockResolvedValue({ ready: true, row: { ...row, contract_version: LEGACY_SUMMARY_VERSION, result: { items: [{ itemId: source.itemId, excerpt: source.text }] } } });
  expect(await getStudentRecordSummary("s")).toMatchObject({ state: "ready", legacy: true, items: [{ summary: null, excerpt: source.text }] });
  expect(m.input).toHaveBeenCalledWith("s", false, LEGACY_SUMMARY_VERSION);
});
it("does not turn read errors into an empty summary", async () => {
  m.saved.mockRejectedValue(new Error("offline")); expect(await getStudentRecordSummary("s")).toMatchObject({ state: "unavailable", items: [] });
});
