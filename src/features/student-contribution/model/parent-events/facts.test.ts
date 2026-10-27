import { expect, it } from "vitest";
import { parentEventFacts, emptyParentEvents, type ParentEventRecord } from "./facts";
import { redactParentEventFact, withCurrentParentEvents } from "./display-facts";
import { canReadFactSource } from "@/features/students/ontology/read-policy";
import { aggregateStudentOntology } from "@/features/students/ontology/aggregate";
const row: ParentEventRecord = { tenantId: "t", studentId: "s", eventId: "seminar-1", eventDate: "2025-07-09", title: "학부모 설명회",
  sourceIds: ["source"], familyKey: "family", basis: "direct", attendanceBasis: "registration_policy" };
const base = { tenant: "t", today: "2026-10-26", capturedAt: "2026-10-26T08:00:00Z", canonical: (id: string) => id, eligible: () => true };
it("includes pre-2026 events and gives siblings independent evidence without revealing contacts or sibling IDs", () => {
  const result = parentEventFacts({ ...base, source: { ready: true, checkedAt: base.capturedAt, records: [row, { ...row, studentId: "sibling", basis: "sibling" }] } });
  expect(result.points.map(p => p.raws.parentSeminarEvents)).toEqual([1, 1]);
  expect(result.points.every(p => p.month === "2025-07")).toBe(true);
  expect(result.facts[0]!.evidence.every(e => e.studentId === result.facts[0]!.studentId)).toBe(true);
  expect(Object.keys(result.facts[0]!.value as object).sort()).toEqual(["attendanceBasis", "attribution", "eventId", "familyKeys", "title"]);
  expect(result.facts[0]!.related).toEqual([{ kind: "academy", id: "t" }]);
  expect(aggregateStudentOntology("t", result.facts, { kind: "academy", id: "t" }).parentEvents).toEqual({ events: 1, familyEvents: 1, studentEvents: 2 });
});
it("distinguishes unimported sources from a reviewed set with no recognized attendance", () => {
  expect(parentEventFacts({ ...base, source: emptyParentEvents() }).coverage.state).toBe("unavailable");
  expect(parentEventFacts({ ...base, source: { ready: true, checkedAt: base.capturedAt, records: [] } }).coverage.state).toBe("ready");
});
it("updates historical evidence after cancellation and merge without resurrecting frozen facts", () => {
  const source = { ready: true, checkedAt: base.capturedAt, records: [row] };
  const frozen = parentEventFacts({ ...base, source }).facts;
  const displayed = withCurrentParentEvents({ ...base, month: "2025-07", facts: frozen, source: { ...source, records: [] } });
  expect(displayed).toEqual([]); expect(frozen).toHaveLength(1);
  expect(withCurrentParentEvents({ ...base, month: "2025-07", facts: frozen, source: emptyParentEvents() })).toEqual([]);
  const merged = withCurrentParentEvents({ ...base, month: "2025-07", facts: frozen, canonical: () => "kept",
    source: { ...source, records: [row, { ...row, studentId: "kept" }] } });
  expect(merged).toHaveLength(1); expect(merged[0]!.studentId).toBe("kept");
  expect(merged[0]!.evidence.map(e => e.studentId).sort()).toEqual(["kept", "s"]);
  expect(canReadFactSource(merged[0]!, new Set(["kept"]))).toBe(false);
  expect(redactParentEventFact(merged[0]!).value).not.toHaveProperty("familyKeys");
});
it("keeps a partial imported set distinct from complete coverage", () => {
  const result = parentEventFacts({ ...base, source: { ready: true, checkedAt: "2026-10-25T16:00:00Z", records: [row], pendingRows: 7 } });
  expect(result.points).toHaveLength(1); expect(result.coverage.state).toBe("pending");
  expect(result.coverage.note).toContain("7행"); expect(result.coverage.through).toBe("2026-10-26");
});
