import { expect, it } from "vitest";
import { parseSource } from "../../../../../scripts/student-contribution/parent-events/parse-source";
import { hash, contact, explicitDate } from "../../../../../scripts/student-contribution/parent-events/source-values";
import { evaluateRegistrations } from "../../../../../scripts/student-contribution/parent-events/evaluate";
import type { SourceProfile, SourceSheet } from "../../../../../scripts/student-contribution/parent-events/source-types";
import { decideEventAttendance } from "./attendance";
const source: SourceSheet = { fileId: "file", title: "가족 설명회", sheet: "신청자", gid: 1, url: "https://docs.google.com/spreadsheets/d/file/edit",
  values: [["학생", "연락처", "상태"], ["가학생", "010-2345-6789", ""], ["나학생", "010-3456-7890", ""]] };
const profile: SourceProfile = { fileId: "file", sheet: "신청자", gid: 1, blocks: [{ start: 0, end: 3, firstRow: 1, headerRow: 0,
  headerHash: hash(source.values[0]), eventKey: "seminar", title: "가족 설명회", date: "2025-07-09", tenantId: "t", eligibleList: true,
  name: 0, phone: 1, markers: [{ column: 2, kind: "cancellation" }], issues: [] }] };
it("keeps source identity through row insertion/reordering and records content changes separately", () => {
  const before = parseSource(source, profile);
  const after = parseSource({ ...source, values: [source.values[0]!, [], source.values[2]!, source.values[1]!] }, profile);
  expect(after[1]!.sourceId).toBe(before[0]!.sourceId);
  expect(after[1]!.sourceRef).not.toBe(before[0]!.sourceRef);
  const changed = parseSource({ ...source, values: [source.values[0]!, ["가학생", "010-2345-6789", "취소"]] }, profile)[0]!;
  expect(changed.sourceId).toBe(before[0]!.sourceId);
  expect(changed.contentHash).not.toBe(before[0]!.contentHash);
  expect(() => parseSource({ ...source, values: [["전화", "이름"], source.values[1]!] }, profile)).toThrow("header changed");
});
it("retains all complete phone numbers and never turns a partial number into a match", () => {
  expect(contact("가보호 010.2345.6789 / 010-3456-7890").phones).toEqual(["01023456789", "01034567890"]);
  expect(contact("6789").invalid).toBe(true);
  expect(explicitDate("2025.08.09(토) 11:00 [1차]")).toBe("2025-08-09");
  expect(explicitDate("8/9, 8/23", 2025)).toBe("");
});
it("holds contradictory copies but preserves a different sibling's valid application", () => {
  const rows = parseSource(source, profile);
  const students = ["가학생", "나학생"].map((name, i) => ({ id: `s${i}`, tenantId: "t", name, guardianName: "가보호", guardianPhone: "01023456789",
    studentPhone: i ? "01034567890" : null, school: null, grade: null, schoolAsOf: null, eligible: true }));
  const cancelled = { ...rows[0]!, sourceId: "copy", markers: [{ kind: "cancellation" as const, value: "취소" }] };
  const result = evaluateRegistrations({ tenantId: "t", today: "2026-10-26", rows: [...rows, cancelled], students, links: [], canonical: id => id });
  expect(result.outcomes[0]!.reasons).toContain("registration_status_conflict");
  expect(result.outcomes[1]!.state).toBe("recognized");
  expect(result.credits.map(c => c.studentId).sort()).toEqual(["s0", "s1"]);
});
it("does not treat a checked absence box as an uncancelled attendance or extend a household transitively", () => {
  const decision = (value: string) => decideEventAttendance({ eligibleList: true, eventDate: "2025-07-09", today: "2026-10-26",
    markers: [{ kind: "absence_checkbox", value }] });
  expect(decision("TRUE").state).toBe("review"); expect(decision("FALSE").state).toBe("recognized");
  const students = ["가학생", "나학생", "다학생"].map((name, i) => ({ id: `s${i}`, tenantId: "t", name,
    guardianName: "가보호", guardianPhone: i < 2 ? "01023456789" : "01045678901", school: null, grade: null, schoolAsOf: null, eligible: true }));
  const row = { ...parseSource(source, profile)[0]!, studentName: "", guardianName: "가보호" };
  const result = evaluateRegistrations({ tenantId: "t", today: "2026-10-26", rows: [row], students,
    links: [{ student_a: "s1", student_b: "s2", linked: true }], canonical: id => id });
  expect(result.credits.map(c => c.studentId).sort()).toEqual(["s0", "s1"]);
});
it("holds cross-file event aliases until one event identity or distinct sessions are reviewed", () => {
  const row = parseSource(source, profile)[0]!;
  const students = [{ id: "s", tenantId: "t", name: "가학생", guardianName: "가보호", guardianPhone: "01023456789",
    school: null, grade: null, schoolAsOf: null, eligible: true }];
  const evaluate = (rows: typeof row[]) => evaluateRegistrations({ tenantId: "t", today: "2026-10-26", rows, students, links: [], canonical: id => id });
  expect(evaluate([row, { ...row, sourceId: "copy", eventId: "other-file-event" }]).credits).toHaveLength(0);
  expect(evaluate([row, { ...row, sourceId: "copy" }]).credits).toHaveLength(1);
  expect(evaluate([row, { ...row, sourceId: "session", eventId: "other-session" }].map(r => ({ ...r, sameDayReviewed: true }))).credits).toHaveLength(2);
});
it("holds a parent-only cancellation even when the application has a student name", () => {
  const row = parseSource(source, profile)[0]!;
  const students = [{ id: "s", tenantId: "t", name: "가학생", guardianName: "가보호", guardianPhone: "01023456789",
    school: null, grade: null, schoolAsOf: null, eligible: true }];
  const result = evaluateRegistrations({ tenantId: "t", today: "2026-10-26", students, links: [], canonical: id => id,
    rows: [row, { ...row, sourceId: "parent-copy", studentName: "", guardianName: "가보호", markers: [{ kind: "cancellation", value: "취소" }] }] });
  expect(result.credits).toHaveLength(0);
  expect(result.outcomes[0]!.reasons).toContain("registration_status_conflict");
});
