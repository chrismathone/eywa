import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SignalRow, SignalSource } from "./signals";
const mocks = vi.hoisted(() => ({ licensed: vi.fn(), sources: vi.fn(), saved: vi.fn(), students: vi.fn(), ai: vi.fn() }));
vi.mock("@/lib/license/server", () => ({ isFeatureLicensed: mocks.licensed }));
vi.mock("./signals", () => ({ loadSignalSources: mocks.sources, loadSignalRows: mocks.saved, signalKey: (s: SignalSource) => `${s.source}:${s.id}` }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: mocks.students }));
vi.mock("@/lib/ai/generate", () => ({ generateJSON: mocks.ai }));
vi.mock("@/lib/ai/model-label", () => ({ modelDisplayLabel: () => "판정 모델" }));
import { judgeStudentPositiveSignals } from "./positive-job";
const source: SignalSource = { id: "p", source: "parent", studentId: "s", day: "2026-09-01", text: "집중하는 시간이 늘었어요.", author: "학부모", hash: "current" };
const saved: SignalRow = { id: "j", source: "parent", source_id: "p", student_id: "s", source_hash: "current", occurred_on: "2026-09-01",
  author_label: "학부모", classification: "observed", evidence: source.text, model_label: "판정 모델", judged_at: "2026-09-02", cancelled_at: null, cancel_reason: null, rejudge_requested_at: null };
function database() {
  const query = { eq: vi.fn(), then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) };
  query.eq.mockReturnValue(query);
  const update = vi.fn<(payload: Record<string, unknown>) => typeof query>(() => query);
  const upsert = vi.fn<(payload: Record<string, unknown>, options: unknown) => typeof query>(() => query);
  return { db: { from: vi.fn(() => ({ update, upsert })) } as unknown as SupabaseClient, update, upsert, query };
}
beforeEach(() => {
  vi.unstubAllEnvs(); vi.stubEnv("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY", "test-key");
  vi.resetAllMocks(); mocks.licensed.mockResolvedValue(true); mocks.sources.mockResolvedValue([source]); mocks.saved.mockResolvedValue([]);
  mocks.students.mockResolvedValue([{ id: "s", notes: null, is_test: false }]);
  mocks.ai.mockResolvedValue({ data: { classification: "observed", evidence: source.text }, model: "model" });
});
it("라이선스가 없으면 원문 조회·AI·저장을 하지 않고 계산 전", async () => {
  mocks.licensed.mockResolvedValue(false); const { db, upsert } = database();
  expect(await judgeStudentPositiveSignals(db, "t", Infinity)).toEqual({ judged: 0, pending: true, failed: 0 });
  expect(mocks.sources).not.toHaveBeenCalled(); expect(mocks.ai).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
});
it("원문이 바뀌었어도 저장된 판정을 자동 재호출하지 않는다", async () => {
  mocks.saved.mockResolvedValue([{ ...saved, source_hash: "old" }]); const { db, upsert } = database();
  expect((await judgeStudentPositiveSignals(db, "t", Infinity)).judged).toBe(0);
  expect(mocks.ai).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
});
it("명시 재판정은 원문 인용을 검증하고 취소 이력을 덮지 않는다", async () => {
  mocks.saved.mockResolvedValue([{ ...saved, cancelled_at: "2026-09-03", rejudge_requested_at: "2026-10-22" }]);
  mocks.ai.mockResolvedValue({ data: { classification: "observed", evidence: "원문에 없는 칭찬" }, model: "model" });
  const { db, update, query } = database();
  expect((await judgeStudentPositiveSignals(db, "t", Infinity)).judged).toBe(1);
  expect(update).toHaveBeenCalledWith(expect.objectContaining({ classification: "other", evidence: "", source_hash: "current", rejudge_requested_at: null }));
  expect(update.mock.calls[0]![0]).not.toHaveProperty("cancelled_at");
  expect(query.eq).toHaveBeenCalledWith("tenant_id", "t"); expect(query.eq).toHaveBeenCalledWith("rejudge_requested_at", "2026-10-22");
  expect(mocks.ai).toHaveBeenCalledWith(expect.objectContaining({ tier: "fast", meta: { feature: "student_positive_signal", tenantId: "t" } }));
});
it("시험 학생·시험 학생으로 병합된 글은 제외하고 문구 후보가 아니면 AI 없이 저장", async () => {
  mocks.students.mockResolvedValue([{ id: "s", notes: null, is_test: false }, { id: "test", notes: null, is_test: true }, { id: "old", notes: "중복 병합: test와 통합됨", is_test: false }]);
  mocks.sources.mockResolvedValue([{ ...source, text: "감사합니다" }, { ...source, id: "p2", studentId: "test" }, { ...source, id: "p3", studentId: "old" }]);
  const { db, upsert } = database();
  expect((await judgeStudentPositiveSignals(db, "t", Infinity)).judged).toBe(1);
  expect(mocks.ai).not.toHaveBeenCalled(); expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ method: "rule", classification: "other" }), expect.anything());
});
it("기한이 지나면 새 판정을 시작하지 않는다", async () => {
  const { db, upsert } = database();
  expect(await judgeStudentPositiveSignals(db, "t", 0)).toMatchObject({ judged: 0, pending: true });
  expect(mocks.ai).not.toHaveBeenCalled(); expect(upsert).not.toHaveBeenCalled();
});
it("Claude 전용 키·낮은 추론을 사용하고 다른 회사로 폴백하지 않는다", async () => {
  const { db } = database(); await judgeStudentPositiveSignals(db, "t", Infinity);
  expect(mocks.ai).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic", tier: "fast", reasoningEffort: "low", allowedProviders: ["anthropic"] }));
});
it("전용 키가 빠진 환경에서는 다른 기능의 키로 비용을 넘기지 않는다", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY_STUDENT_ONTOLOGY", "");
  const { db } = database();
  expect(await judgeStudentPositiveSignals(db, "t", Infinity)).toMatchObject({ judged: 0, pending: true });
  expect(mocks.ai).not.toHaveBeenCalled(); expect(mocks.sources).not.toHaveBeenCalled();
});
