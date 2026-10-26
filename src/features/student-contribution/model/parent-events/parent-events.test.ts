import { describe, expect, it } from "vitest";
import { decideEventAttendance } from "./attendance";
import { deduplicateEventCredits, eventCreditCounts, type RecognizedEvent } from "./credits";
import { eventFamilyAttributions } from "./family";
import { matchEventIdentity } from "./identity";
import type { EventIdentity, EventStudent } from "./types";

const today = "2026-10-26";
const student = (id: string, patch: Partial<EventStudent> = {}): EventStudent => ({ id, tenantId: "t", name: "가학생A", guardianName: "가보호",
  guardianPhone: "010-2345-6789", school: "가람초", grade: "초6", schoolAsOf: today, eligible: true, ...patch });
const identity = (patch: Partial<EventIdentity> = {}): EventIdentity => ({ tenantId: "t", eventId: "event-1", eventDate: "2025-07-09",
  sourceRef: "source:row", studentName: "가학생", guardianName: "가보호", phones: ["01023456789"], school: "가람초", grade: "초5", ...patch });
const match = (input: Partial<EventIdentity>, students: EventStudent[]) => matchEventIdentity(identity(input), students, [], today);

describe("event identity guards", () => {
  it("requires name and full phone and respects an explicitly written suffix", () => {
    expect(match({}, [student("a")]).studentIds).toEqual(["a"]);
    expect(match({ studentName: "가학생B" }, [student("a")]).state).toBe("review");
    expect(match({ phones: ["6789"] }, [student("a")]).reasons).toContain("phone_invalid");
    expect(match({ phones: ["0531234567"] }, [student("a")]).state).toBe("review");
  });
  it("does not choose the first same-name candidate, or ignore a conflicting number", () => {
    expect(match({}, [student("a"), student("b", { name: "가학생B" })]).reasons).toContain("ambiguous_student");
    expect(match({ phones: ["01023456789", "01034567890"] }, [student("a")]).state).toBe("review");
  });
  it("treats missing school as missing evidence, not a contradiction", () => {
    expect(match({ school: "", grade: "" }, [student("a")]).state).toBe("matched");
    expect(match({ school: "다른초" }, [student("a")]).reasons).toContain("school_conflict");
    expect(match({ grade: "초3" }, [student("a")]).reasons).toContain("grade_conflict");
  });
  it("checks historical school-year and explicit next-year grades", () => {
    expect(match({ grade: "예비초6" }, [student("a")]).state).toBe("matched");
    expect(match({ eventDate: "2026-02-10", grade: "초5" }, [student("a")]).state).toBe("matched");
    expect(match({ eventDate: "2026-07-09", grade: "초5", gradeAsOf: "2025-03-01", school: "대구가람초등학교" }, [student("a")]).state).toBe("matched");
    expect(match({}, [student("a", { grade: "중1", school: "가람중", schoolAsOf: "2027-10-26" })]).state).toBe("review");
    expect(match({ eventDate: "2024-07-09", grade: "초6", school: "가람초" }, [student("a", { grade: "중2", school: "가람중" })]).state).toBe("matched");
  });
  it("links a parent-only row only to one verified family", () => {
    const children = [student("a"), student("b", { name: "가동생", grade: "초4" })];
    expect(match({ studentName: "" }, children).studentIds).toEqual(["a", "b"]);
    expect(match({ studentName: "", school: "다른초" }, children).reasons).toContain("school_conflict");
    expect(match({ studentName: "", guardianName: "" }, children).reasons).toContain("guardian_missing");
    expect(match({ studentName: "" }, [...children, student("c", { name: "나학생", guardianName: "나보호" })]).state).toBe("review");
    expect(matchEventIdentity(identity({ studentName: "" }), children, [{ student_a: "a", student_b: "b", linked: false }], today).state).toBe("review");
  });
  it("never matches another tenant, excluded profile, or missing event/source", () => {
    expect(match({}, [student("a", { tenantId: "other" })]).state).toBe("review");
    expect(match({}, [student("a", { eligible: false })]).state).toBe("review");
    expect(match({ sourceRef: "", eventId: "" }, [student("a")]).reasons).toEqual(["source_missing", "event_missing"]);
  });
});

describe("direct sibling attribution", () => {
  const people = [student("a"), student("b", { name: "가동생" }), student("c", { name: "가막내", guardianPhone: null })];
  it("reuses phone/manual sibling rules without name-only or transitive expansion", () => {
    expect(eventFamilyAttributions("a", people, []).map(r => r.studentId)).toEqual(["a", "b"]);
    expect(eventFamilyAttributions("a", people, [{ student_a: "b", student_b: "c", linked: true }]).map(r => r.studentId)).toEqual(["a", "b"]);
    expect(eventFamilyAttributions("a", people, [{ student_a: "a", student_b: "c", linked: true }]).map(r => r.studentId)).toEqual(["a", "b", "c"]);
  });
  it("honors explicit removal and excludes duplicate same-name profiles", () => {
    expect(eventFamilyAttributions("a", people, [{ student_a: "a", student_b: "b", linked: false }]).map(r => r.studentId)).toEqual(["a"]);
    expect(eventFamilyAttributions("a", [student("a"), student("b", { name: "가학생B" })], []).map(r => r.studentId)).toEqual(["a"]);
  });
});

describe("registration-unless-cancelled policy", () => {
  const base = { eligibleList: true, eventDate: "2026-07-09", today, markers: [] };
  it("recognizes a valid application without requiring actual-attendance markers", () => {
    expect(decideEventAttendance(base)).toMatchObject({ state: "recognized", basis: "registration_policy" });
    expect(decideEventAttendance({ ...base, markers: [{ kind: "confirmation", value: "부재중" }] }).state).toBe("recognized");
    expect(decideEventAttendance({ ...base, markers: [{ kind: "attendance", value: "참석확인" }] })).toMatchObject({ state: "recognized", basis: "registration_policy" });
  });
  it("keeps ambiguous absence and cancellation text for review", () => {
    expect(decideEventAttendance({ ...base, markers: [{ kind: "attendance", value: "불참" }] }).state).toBe("review");
    expect(decideEventAttendance({ ...base, markers: [{ kind: "note", value: "취소했다가 재신청" }] }).state).toBe("review");
    expect(decideEventAttendance({ ...base, markers: [{ kind: "cancellation", value: "TRUE" }] }).state).toBe("cancelled");
    expect(decideEventAttendance({ ...base, markers: [{ kind: "attendance", value: "참석" }, { kind: "cancellation", value: "취소" }] }).state).toBe("review");
  });
  it("does not count future events, invitation lists, or invalid dates", () => {
    expect(decideEventAttendance({ ...base, eventDate: "2026-11-01" }).state).toBe("scheduled");
    expect(decideEventAttendance({ ...base, eligibleList: false }).state).toBe("excluded");
    expect(decideEventAttendance({ ...base, eventDate: "2026-02-30" }).state).toBe("review");
  });
});

describe("event credit deduplication", () => {
  const row: RecognizedEvent = { tenantId: "t", eventId: "event-1", eventDate: "2025-07-09", studentId: "a", familyKey: "family", sourceIds: ["source-a"], basis: "sibling" };
  it("canonicalizes before deduplication and retains each sibling's unique fact", () => {
    const rows = [row, { ...row, studentId: "merged", sourceIds: ["source-b"], basis: "direct" as const }, { ...row, studentId: "b" }];
    const credits = deduplicateEventCredits("t", rows, id => id === "merged" ? "a" : id, today);
    expect(credits).toHaveLength(2);
    expect(new Set(credits.map(r => r.id)).size).toBe(2);
    expect(credits[0]).toMatchObject({ basis: "direct", sourceIds: ["source-a", "source-b"] });
    expect(eventCreditCounts(credits)).toEqual({ events: 1, students: 2, studentEvents: 2, familyEvents: 1 });
    expect(deduplicateEventCredits("t", [...rows, ...rows], id => id === "merged" ? "a" : id, today)).toEqual(credits);
  });
  it("keeps two same-day events separate and rejects inconsistent event dates", () => {
    expect(deduplicateEventCredits("t", [row, { ...row, eventId: "event-2" }], id => id, today)).toHaveLength(2);
    expect(() => deduplicateEventCredits("t", [row, { ...row, eventDate: "2025-07-10" }], id => id, today)).toThrow("Conflicting event dates");
    expect(() => deduplicateEventCredits("t", [{ ...row, tenantId: "other" }], id => id, today)).toThrow();
  });
});
