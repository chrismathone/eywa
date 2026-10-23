import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentFact } from "@/features/students/ontology/types";
import type { SignalRow } from "./signals";
const mocks = vi.hoisted(() => ({ sources: vi.fn() }));
vi.mock("./signals", () => ({ loadSignalSources: mocks.sources }));
import { projectSignalDisplay } from "./signal-display";
const row: SignalRow = { id: "signal", source: "parent", source_id: "message", student_id: "s", source_hash: "hash", occurred_on: "2026-10-01",
  author_label: "학부모", classification: "observed", evidence: "이전 인용문", model_label: "Claude", judged_at: "2026-10-02",
  cancelled_at: null, cancel_reason: "민감한 사유", rejudge_requested_at: null };
const fact: StudentFact = { id: "f", tenantId: "t", studentId: "s", kind: "observation", value: { evidence: row.evidence, author: row.author_label, classification: row.classification },
  occurred: { precision: "day", value: row.occurred_on }, recordedAt: row.judged_at, evidence: [{ source: "student_positive_signals", id: row.id, studentId: "s" }], related: [], access: "contribution", basis: "ai", state: "active" };
const db = {} as SupabaseClient;
beforeEach(() => { vi.resetAllMocks(); mocks.sources.mockResolvedValue([{ source: "parent", id: "message", studentId: "s", hash: "hash" }]); });
it("returns a current quote without internal source hashes", async () => {
  const result = await projectSignalDisplay(db, "t", [row]);
  expect(result.signals[0]).toMatchObject({ evidence: row.evidence, evidenceStatus: "current" });
  expect(result.signals[0]).not.toHaveProperty("source_hash");
  expect(result.canShowObservation(fact)).toBe(true);
  expect(mocks.sources).toHaveBeenCalledWith(db, "t", ["s"]);
});
it.each([{ sources: [] }, { sources: [{ source: "parent", id: "message", studentId: "s", hash: "edited" }] }, { sources: [{ source: "parent", id: "message", studentId: "other", hash: "hash" }] }])("redacts deleted, edited, or reassigned source", async ({ sources }) => {
  mocks.sources.mockResolvedValue(sources);
  const result = await projectSignalDisplay(db, "t", [row]);
  expect(result.signals[0]).toMatchObject({ evidence: "", author_label: null, cancel_reason: null });
  expect(result.canShowObservation(fact)).toBe(false);
  expect(row.evidence).toBe("이전 인용문");
});
it("redacts a frozen quote superseded by a later judgment", async () => {
  const result = await projectSignalDisplay(db, "t", [{ ...row, judged_at: "2026-10-03", evidence: "새 인용문" }]);
  expect(result.canShowObservation(fact)).toBe(false);
});
it("keeps non-observation facts when source verification fails", async () => {
  mocks.sources.mockRejectedValue(new Error("offline"));
  const result = await projectSignalDisplay(db, "t", [row]);
  expect(result.signals[0]?.evidenceStatus).toBe("unavailable");
  expect(result.canShowObservation(fact)).toBe(false);
  expect(result.canShowObservation({ ...fact, kind: "attendance" })).toBe(true);
});
