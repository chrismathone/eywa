import { expect, it } from "vitest";
import { describeTeacherAssignments, validateLiveRelation, type LiveRelation } from "./live-relations";
import { ontologyAttendanceAxis } from "./attendance-axis";

const relation: LiveRelation = { tenantId: "t", kind: "homeroom", from: { kind: "class", id: "c" }, to: { kind: "teacher", id: "a" },
  asOf: "2026-10-23", version: "student-live-v1", period: null,
  evidence: [{ source: "classes", id: "c", studentId: "s", href: "/classes/c" }] };
it("keeps unknown assignment dates separate from open-ended known dates", () => {
  expect(validateLiveRelation(relation)).toBeNull();
  expect(validateLiveRelation({ ...relation, period: { from: "2026-10-01", through: null } })).toBeNull();
});
it("rejects a role with the wrong endpoint or no evidence", () => {
  expect(validateLiveRelation({ ...relation, from: { kind: "student", id: "s" } })).toBe("endpoint_type");
  expect(validateLiveRelation({ ...relation, evidence: [] })).toBe("missing_evidence");
});
it.each(["2026-10-22", "2026-10-24"])("does not treat an inactive role as current: %s", (day) => {
  expect(validateLiveRelation({ ...relation, period: { from: day, through: day } })).toBe("inactive_period");
});
it("keeps homeroom and scheduled roles distinct for the same person", () => {
  expect(describeTeacherAssignments([relation, { ...relation, kind: "scheduledTeacher" }], new Map([["a", "담당자"]])))
    .toBe("담임 담당자 / 교시 담당 담당자");
});

const input: Parameters<typeof ontologyAttendanceAxis>[0] = { date: "2026-10-22", today: "2026-10-23", historyFrom: "2025-10-01",
  currentTeacher: "new", history: [], slots: [], taughtBy: null, slotStart: null };
it("never fills a historical unknown from the current homeroom", () => expect(ontologyAttendanceAxis(input)).toEqual({ teacherId: null, source: "none" }));
it("uses the current assignment for today", () => expect(ontologyAttendanceAxis({ ...input, date: input.today }).teacherId).toBe("new"));
it("uses the source rule for an open audited interval with a newer current assignment", () => {
  expect(ontologyAttendanceAxis({ ...input, history: [{ teacherId: "old", from: "2026-10-01", to: null }] }).teacherId).toBe("new");
});
it("honors the exclusive end of an audited homeroom interval", () => {
  const history = [{ teacherId: "old", from: null, to: "2026-10-22" }, { teacherId: "new", from: "2026-10-22", to: null }];
  expect(ontologyAttendanceAxis({ ...input, history, date: "2026-10-21" }).teacherId).toBe("old");
  expect(ontologyAttendanceAxis({ ...input, history }).teacherId).toBe("new");
});
it("does not extrapolate a history interval outside the queried audit window", () => {
  expect(ontologyAttendanceAxis({ ...input, date: "2024-01-01", history: [{ teacherId: "old", from: null, to: "2026-10-22" }] }).teacherId).toBeNull();
});
it("ignores an expired schedule but uses one valid on the record date", () => {
  const slot = { dayOfWeek: "thu", startTime: "16:00", teacherId: "slot", slotTeacherLabel: null, validFrom: "2026-01-01", validTo: "2026-10-21" };
  expect(ontologyAttendanceAxis({ ...input, slots: [slot] }).teacherId).toBeNull();
  expect(ontologyAttendanceAxis({ ...input, slots: [{ ...slot, validTo: "2026-10-22" }] }).teacherId).toBe("slot");
});
it.each([{ recordedVia: "seat" }, { seatLabel: "LAB" }])("preserves seat evidence outside the timetable: %o", (marker) => {
  expect(ontologyAttendanceAxis({ ...input, date: input.today, ...marker })).toEqual({ teacherId: null, source: "seat" });
});
it("preserves explicit substitute attribution before seat or current teacher fallback", () => {
  expect(ontologyAttendanceAxis({ ...input, taughtBy: "actual", recordedVia: "seat" })).toEqual({ teacherId: "actual", source: "substitute" });
});
