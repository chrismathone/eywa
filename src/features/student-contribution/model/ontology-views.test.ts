import { expect, it } from "vitest";
import type { StudentFact } from "@/features/students/ontology/types";
import { projectOntologyViews } from "./ontology-views";
const fact: StudentFact = { id: "record", tenantId: "t", studentId: "old", kind: "attendance", access: "student", value: {},
  occurred: { precision: "day", value: "2026-10-23" }, recordedAt: "2026-10-23", basis: "recorded", state: "active",
  evidence: [{ source: "attendance_records", id: "record", studentId: "old" }],
  related: [{ kind: "class", id: "c1" }, { kind: "class", id: "c2" }, { kind: "teacher", id: "teacher" }] };
const canonical = (id: string) => id === "old" ? "merged" : id;
const row = (f: StudentFact, at = "2026-10-23") => ({ student_id: f.studentId, computed_at: at, facts: [f] });
it("does not resurrect an accessible old source when the latest version moves outside scope", () => {
  const latest = { ...fact, studentId: "private", evidence: [{ ...fact.evidence[0], studentId: "private" }] };
  expect(projectOntologyViews("t", [row(fact, "2026-10-22"), row(latest)], new Set(["merged", "private"]), canonical, new Set(["old"]))).toEqual({});
});
it("a canonical student permission does not grant former-source permission", () => {
  expect(projectOntologyViews("t", [row(fact)], new Set(["merged"]), canonical, new Set(["merged"]))).toEqual({});
});
it("one fact connected to multiple classes still counts once at the academy", () => {
  const result = projectOntologyViews("t", [row(fact), row(fact)], new Set(["merged"]), canonical, null);
  expect(result["academy:t"].factCount).toBe(1); expect(result["academy:t"].students).toEqual(["merged"]);
  expect(result["class:c1"].factCount).toBe(1); expect(result["class:c2"].factCount).toBe(1);
});
it("does not reveal a referral's other student outside the original scope", () => {
  const referral = { ...fact, kind: "referred" as const, value: { prospectId: "private" } };
  expect(projectOntologyViews("t", [row(referral)], new Set(["merged"]), canonical, new Set(["old"]))).toEqual({});
});
it("rejects other-tenant source data before projection", () => {
  expect(() => projectOntologyViews("t", [row({ ...fact, tenantId: "other" })], new Set(["merged"]), canonical, null)).toThrow();
});
