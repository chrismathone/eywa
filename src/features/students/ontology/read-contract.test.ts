import { describe, expect, it } from "vitest";
import { buildStudentIdentityIndex } from "./identity-index";
import { studentIdentity } from "./identity";
import { canReadFactSource, signalEvidenceStatus } from "./read-policy";
import { activeOn, sectionResult, validateLiveSection, type LiveItem } from "./live-contract";
import type { StudentFact } from "./types";

const student = (id: string, target?: string) => ({ id, notes: target ? `중복 병합: ${target}와 통합됨` : null });
const fact: StudentFact = { id: "f", tenantId: "t", studentId: "old", kind: "observation", access: "contribution",
  value: { quote: "original" }, occurred: { precision: "day", value: "2026-10-23" }, recordedAt: "now", basis: "ai",
  state: "active", related: [], evidence: [{ source: "student_positive_signals", id: "p", studentId: "old" }] };
const item: LiveItem = { id: "e", title: "수학", detail: "담임", evidence: [{ source: "enrollments", id: "e", studentId: "s", href: "/students/s" }] };

describe("read identity quarantine", () => {
  it("keeps independent students even when a different chain is broken", () => {
    const index = buildStudentIdentityIndex([student("a"), student("b", "missing")]);
    expect(index.resolve("a")).toBe("a"); expect(index.resolve("b")).toBeNull();
    expect(index.issues).toEqual([{ studentId: "b", reason: "missing_target" }]);
  });
  it("resolves a complete multi-step chain", () => expect(buildStudentIdentityIndex([student("a", "b"), student("b", "c"), student("c")]).resolve("a")).toBe("c"));
  it("does not infer identity from equal names", () => expect(buildStudentIdentityIndex([student("a"), student("b")]).ids).toEqual(["a", "b"]));
  it("quarantines the whole cyclic component including upstream links", () => {
    const index = buildStudentIdentityIndex([student("a", "b"), student("b", "a"), student("c", "a"), student("ok")]);
    expect(index.ids).toEqual(["ok"]); expect(index.issues).toHaveLength(3);
  });
  it("quarantines self merges", () => expect(buildStudentIdentityIndex([student("a", "a")]).issues[0]?.reason).toBe("cycle"));
  it("keeps an ordinary review memo that is not the actual merge marker", () => {
    const rows = [{ id: "a", notes: "중복 병합: 확인 요망" }];
    expect(buildStudentIdentityIndex(rows).resolve("a")).toBe(studentIdentity(rows)("a"));
    expect(buildStudentIdentityIndex(rows).issues).toEqual([]);
  });
  it("rejects an unknown source id", () => expect(buildStudentIdentityIndex([student("a")]).resolve("foreign")).toBeNull());
  it("preserves strict failure for writes and aggregation", () => expect(() => studentIdentity([student("a", "missing")])).toThrow());
});

describe("original source access", () => {
  it("does not let the merged target grant access to an older quote", () => expect(canReadFactSource(fact, new Set(["new"]))).toBe(false));
  it("protects contribution-labelled positive quotations", () => expect(canReadFactSource(fact, new Set())).toBe(false));
  it("allows a readable original student", () => expect(canReadFactSource(fact, new Set(["old"]))).toBe(true));
  it("requires access to every student in mixed evidence", () => expect(canReadFactSource({ ...fact, evidence: [...fact.evidence, { source: "students", id: "x", studentId: "other" }] }, new Set(["old"]))).toBe(false));
  it("keeps billing facts behind the existing billing gate", () => expect(canReadFactSource({ ...fact, access: "billing" }, new Set())).toBe(true));
  it("allows unrestricted source readers", () => expect(canReadFactSource(fact, null)).toBe(true));
  it("hides removed source quotes", () => expect(signalEvidenceStatus({ student_id: "s", source_hash: "h" }, undefined)).toBe("unavailable"));
  it("hides changed source quotes", () => expect(signalEvidenceStatus({ student_id: "s", source_hash: "h" }, { studentId: "s", hash: "new" })).toBe("changed"));
  it("hides reassigned source quotes even if hashes match", () => expect(signalEvidenceStatus({ student_id: "s", source_hash: "h" }, { studentId: "other", hash: "h" })).toBe("changed"));
  it("shows current source quotes", () => expect(signalEvidenceStatus({ student_id: "s", source_hash: "h" }, { studentId: "s", hash: "h" })).toBe("current"));
});

describe("live source contract", () => {
  it.each([["2026-10-01", true], ["2026-10-23", true], ["2026-10-24", false], ["2026-09-30", false]])("honors inclusive source dates %s", (day, expected) => expect(activeOn(day as string, "2026-10-01", "2026-10-23")).toBe(expected));
  it("allows an open enrollment", () => expect(activeOn("2026-10-23", null, null)).toBe(true));
  it("retains total beyond the displayed sample", () => expect(sectionResult("e", "수강", "/students/s", [item], 100).total).toBe(100));
  it("rejects a misleading total", () => expect(() => sectionResult("e", "수강", "/students/s", [item], 0)).toThrow());
  it("requires source evidence", () => expect(validateLiveSection(sectionResult("e", "수강", "/", [{ ...item, evidence: [] }], 1))[0]?.code).toBe("missing_evidence"));
  it("rejects external evidence links", () => expect(validateLiveSection(sectionResult("e", "수강", "/", [{ ...item, evidence: [{ ...item.evidence[0]!, href: "//evil.test" }] }], 1))[0]?.code).toBe("invalid_link"));
  it("detects repeated source ids", () => expect(validateLiveSection(sectionResult("e", "수강", "/", [item, item], 2))[0]?.code).toBe("duplicate_id"));
});
