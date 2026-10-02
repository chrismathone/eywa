import { expect, it } from "vitest";
import { attendanceDecisionSchema, attendanceReviewReasons, buildAttendanceDecision, dateAliases } from "./jev-decision";
it("resolves month/year/leap-day rollover in code", () => {
  expect(dateAliases("2026-12-31")).toMatchObject({ 오늘: "2026-12-31", 내일: "2027-01-01", 모레: "2027-01-02" });
  expect(dateAliases("2028-02-28").내일).toBe("2028-02-29");
});
it("anchors each correction to its own date and retains full text", () => {
  const decision = buildAttendanceDecision({ studentName: "민준", course: "수학", targetDate: "2027-01-01",
    history: [{ date: "2026-12-31", content: "내일 결석해요" }], latest: { date: "2027-01-01", content: "취소하고 오늘 정상 등원해요" } });
  expect(decision.state).toMatchObject({ history: [{ date_aliases: { 내일: "2027-01-01" } }], latest: { date_aliases: { 오늘: "2027-01-01" }, content: "취소하고 오늘 정상 등원해요" } });
  expect(decision.questions.attendance.instructions).toContain("학생=민준, 과목=수학, 판정할 날짜=2027-01-01");
});
it("rejects impossible dates rather than normalizing them", () => {
  expect(attendanceDecisionSchema.safeParse({ studentName: "민준", course: "수학", targetDate: "2026-02-30", history: [], latest: { date: "2026-10-02", content: "결석" } }).success).toBe(false);
});
it("does not let high confidence hide none, cancellations or history", () => {
  const answer = { type: "choice" as const, choice: "none", confidence: 0.99, probabilities: { none: 1 } };
  expect(attendanceReviewReasons(answer, 2)).toEqual(["none_requires_review", "thread_context_used"]);
  expect(attendanceReviewReasons({ ...answer, choice: "normal" }, 0)).toEqual(["normal_or_cancellation"]);
  expect(attendanceReviewReasons({ ...answer, choice: "absence", confidence: 0.5 }, 0)).toEqual(["low_confidence"]);
});
