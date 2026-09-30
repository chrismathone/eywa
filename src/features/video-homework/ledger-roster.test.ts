import { describe, expect, it } from "vitest";
import { buildVideoHomeworkLessonPairs, isVideoHomeworkRange, type LedgerEnrollment } from "./ledger-roster";

const enrollment: LedgerEnrollment = { class_id: "a", student_id: "student", start_date: "2026-09-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null };
const input: Parameters<typeof buildVideoHomeworkLessonPairs>[0] = {
  classes: [{ id: "a", class_name: "수학 A", subject: "math", is_active: true, closed_at: null }],
  enrollments: [enrollment], schedules: [
    { class_id: "a", day_of_week: "tue", valid_from: null, valid_to: null },
    { class_id: "a", day_of_week: "thu", valid_from: null, valid_to: null },
  ], occurrences: [], fromDate: "2026-09-01", toDate: "2026-09-10", today: "2026-09-30",
};
describe("기간별 미확인 학생 명단", () => {
  it("기록이 없어도 기간 전체 수업일을 만들고 중복 교시는 한 회차로 센다", () => {
    const result = buildVideoHomeworkLessonPairs({ ...input, schedules: [...input.schedules, input.schedules[0]] });
    expect(result[0].lessonDates).toEqual(["2026-09-01", "2026-09-03", "2026-09-08", "2026-09-10"]);
  });
  it("분리등원과 수강 시작·종료를 반영한다", () => {
    const result = buildVideoHomeworkLessonPairs({ ...input, enrollments: [{ ...enrollment, attendance_days: ["thu"], start_date: "2026-09-02", end_date: "2026-09-10" }] });
    expect(result[0].lessonDates).toEqual(["2026-09-03", "2026-09-10"]);
  });
  it("반 이동일은 이전 수강에서 빼고 일반 종료일은 포함한다", () => {
    const result = buildVideoHomeworkLessonPairs({ ...input, enrollments: [{ ...enrollment, end_date: "2026-09-03", is_transferred: true }] });
    expect(result[0].lessonDates).toEqual(["2026-09-01"]);
  });
  it("휴원·종강 후 정규 수업은 빼도 출결·보강·기존 검사일은 보존한다", () => {
    const result = buildVideoHomeworkLessonPairs({ ...input, classes: [{ ...input.classes[0], closed_at: "2026-09-01" }],
      enrollments: [{ ...enrollment, on_hold: true }], occurrences: [
        { class_id: "a", student_id: "student", date: "2026-09-05" },
        { class_id: "a", student_id: "student", date: "2026-09-05" },
        { class_id: "a", student_id: "student", date: "2026-08-31" },
      ] });
    expect(result[0].lessonDates).toEqual(["2026-09-05"]);
  });
  it("수업 일정의 유효기간을 지킨다", () => {
    const result = buildVideoHomeworkLessonPairs({ ...input, schedules: [{ ...input.schedules[0], valid_from: "2026-09-05", valid_to: "2026-09-09" }] });
    expect(result[0].lessonDates).toEqual(["2026-09-08"]);
  });
  it("역전·잘못된 날짜·지나치게 긴 기간은 거절한다", () => {
    expect(isVideoHomeworkRange("2026-02-30", "2026-03-05")).toBe(false);
    expect(isVideoHomeworkRange("2026-09-10", "2026-09-01")).toBe(false);
    expect(isVideoHomeworkRange("2025-01-01", "2026-09-01")).toBe(false);
    expect(isVideoHomeworkRange("2026-09-01", "2026-09-01")).toBe(true);
  });
});
