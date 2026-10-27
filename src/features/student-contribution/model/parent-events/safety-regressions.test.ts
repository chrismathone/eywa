import { expect, it } from "vitest";
import { evaluateRegistrations } from "../../../../../scripts/student-contribution/parent-events/evaluate";
import { contact, explicitDate } from "../../../../../scripts/student-contribution/parent-events/source-values";
import type { ParsedRegistration } from "../../../../../scripts/student-contribution/parent-events/source-types";
import { decideEventAttendance } from "./attendance";
import { matchEventIdentity } from "./identity";
import type { EventStudent } from "./types";
const student = (id: string, name: string, phone = "01023456789"): EventStudent => ({ id, name, tenantId: "t", guardianName: "가보호", guardianPhone: phone,
  eligible: true, school: null, grade: null, schoolAsOf: null });
const row = (id: string, name = "가학생"): ParsedRegistration => ({ tenantId: "t", eventId: "august", eventDate: "2025-08-09", sourceRef: "sheet",
  studentName: name, guardianName: "가보호", phones: ["01023456789"], school: "", grade: "", sourceId: id, identityHash: id, contentHash: id,
  fileId: "file", sheetId: 1, row: 2, eventTitle: "설명회", eligibleList: true, issues: [], markers: [], raw: [] });
it("holds a conflicting prior-event X without misreading it as the current event's absence", () => {
  const november = { ...row("november"), eventId: "november", eventDate: "2025-11-01",
    markers: [{ kind: "other_event_attendance" as const, value: "X", targetEventIds: ["august"] }] };
  const result = evaluateRegistrations({ tenantId: "t", today: "2026-10-26", rows: [row("august"), november], students: [student("s", "가학생")], links: [], canonical: id => id });
  expect(result.outcomes[0]!.reasons).toContain("cross_source_absence");
  expect(result.credits.map(c => c.eventId)).toEqual(["november"]);
});
it("holds only the overlapping household and leaves an unrelated family's event eligible", () => {
  const students = [student("a", "가학생"), student("b", "가동생"), student("c", "가막내", "01034567890"), student("d", "나학생", "01045678901")];
  const result = evaluateRegistrations({ tenantId: "t", today: "2026-10-26", rows: [row("a"), row("b", "가동생"), { ...row("d", "나학생"), phones: ["01045678901"] }],
    students, links: [{ student_a: "a", student_b: "c", linked: true }], canonical: id => id });
  expect(result.credits.map(c => c.studentId)).toEqual(["d"]);
  expect(result.outcomes[0]!.reasons).toContain("household_partition_conflict");
});
it("does not infer a family from shared phone numbers without parent identity", () => {
  const people = [student("a", "가학생"), student("b", "나학생"), student("c", "다학생")].map(s => ({ ...s, guardianName: null }));
  expect(matchEventIdentity(row("a"), people, [], "2026-10-26").state).toBe("review");
});
it("holds unexplained confirmation marks, absence notes, date ranges and partial second phones", () => {
  for (const value of ["TRUE", "X", "V"]) expect(decideEventAttendance({ eligibleList: true, eventDate: "2025-01-01", today: "2026-10-26", markers: [{ kind: "confirmation", value }] }).state).toBe("review");
  for (const value of ["X", "FALSE", "노쇼", "안 오심", "안 옴", "못 옴", "이번엔 참석이 어렵다고 하심", "다음에 오기로", "불가"]) expect(decideEventAttendance({ eligibleList: true, eventDate: "2025-01-01", today: "2026-10-26", markers: [{ kind: "note", value }] }).state).toBe("review");
  expect(explicitDate("8월 9일 ~ 10일", 2025)).toBe("");
  expect(contact("010-2345-6789, 010-345-678").invalid).toBe(true);
});
it("holds name-only cancellations without conflating explicit A/B or unrelated complete phone identities", () => {
  const evaluate = (name: string, cancelName: string, phones: string[] = []) => evaluateRegistrations({ tenantId: "t", today: "2026-10-26",
    rows: [row("yes", name), { ...row("cancel", cancelName), phones, markers: [{ kind: "cancellation", value: "취소" }] }],
    students: [student("s", name)], links: [], canonical: id => id });
  expect(evaluate("가학생", "가학생").credits).toEqual([]);
  expect(evaluate("가학생A", "가학생").credits).toEqual([]);
  expect(evaluate("가학생A", "가학생B").credits).toHaveLength(1);
  expect(evaluate("가학생", "가학생", ["01087654321"]).credits).toHaveLength(1);
});
it("does not use parent relationship labels as a person's identity", () => {
  for (const guardianName of ["어머니", "어머님", "학부모", "보호자", "-"]) {
    const people = [student("a", "가학생"), student("b", "나학생"), student("c", "다학생")].map(s => ({ ...s, guardianName }));
    expect(matchEventIdentity(row("a"), people, [], "2026-10-26").state).toBe("review");
    expect(matchEventIdentity({ ...row("a"), studentName: "", guardianName }, [people[0]!], [], "2026-10-26").state).toBe("review");
  }
});
it("recognizes registered parents with non-cancellation call results", () => {
  for (const value of ["부재", "o", "○", "전화돌림", "통화함"]) {
    expect(decideEventAttendance({ eligibleList: true, eventDate: "2025-01-01", today: "2026-10-26", markers: [{ kind: "confirmation", value }] })).toMatchObject({ state: "recognized", basis: "registration_policy" });
  }
});
