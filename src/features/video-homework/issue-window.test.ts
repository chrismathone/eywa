import { describe, expect, it } from "vitest";
import { classMeetsOn, extraIssueLessonError, extraIssueWindow } from "./issue-window";

// 2026-10-06 = 화요일 · 10-09 = 금요일 · 10-13 = 화요일. 반은 화·금 수업.
const schedules = [{ day_of_week: "tue", valid_from: "2026-03-01", valid_to: null }, { day_of_week: "fri", valid_from: "2026-03-01", valid_to: null }];
const enrollment = { class_id: "c", student_id: "s", start_date: "2026-03-01", end_date: null, on_hold: false, is_transferred: false, attendance_days: null };
const none = () => false;

describe("따로 내는 숙제 — 그날 수업을 들었나", () => {
  it("출석한 날은 낼 수 있다", () => {
    expect(extraIssueLessonError({ date: "2026-10-06", schedules, enrollments: [enrollment], slots: [{ status: "present" }] })).toBeNull();
  });
  it("결석한 날 · 수강 전 · 수업 없는 요일은 까닭을 말한다", () => {
    expect(extraIssueLessonError({ date: "2026-10-06", schedules, enrollments: [enrollment], slots: [{ status: "absent" }] })).toMatch("결석");
    expect(extraIssueLessonError({ date: "2026-10-06", schedules, enrollments: [{ ...enrollment, start_date: "2026-10-07" }], slots: [] })).toMatch("수강생");
    expect(extraIssueLessonError({ date: "2026-10-07", schedules, enrollments: [enrollment], slots: [] })).toMatch("수업이 없었습니다");
  });
  it("출결 기록이 없어도 시간표상 수업일이면 낼 수 있다(출결을 늦게 찍는 반)", () => {
    expect(extraIssueLessonError({ date: "2026-10-06", schedules, enrollments: [enrollment], slots: [] })).toBeNull();
  });
  it("보강(출석 아님)만 있는 날은 결석과 같다", () => {
    expect(extraIssueLessonError({ date: "2026-10-06", schedules, enrollments: [enrollment], slots: [{ status: "absent" }, { status: "makeup" }] })).toMatch("결석");
  });
});

describe("따로 내는 숙제 — 다음 수업 전까지만", () => {
  const base = { homeworkDate: "2026-10-06", schedules, enrollments: [enrollment], isHoliday: none, lessonDates: [] as string[] };
  it("다음 수업일(금)이 오기 전이면 열려 있다", () => {
    expect(extraIssueWindow({ ...base, today: "2026-10-08" })).toEqual({ open: true });
  });
  it("🔑 오늘이 다음 수업일이어도 그 수업의 출결·보고서가 남기 전이면 열려 있다", () => {
    expect(extraIssueWindow({ ...base, today: "2026-10-09" })).toEqual({ open: true });
    expect(extraIssueWindow({ ...base, today: "2026-10-09", lessonDates: ["2026-10-09"] })).toEqual({ open: false, nextLesson: "2026-10-09" });
  });
  it("다음 수업일이 지났으면 닫힌다(출결이 없어도)", () => {
    expect(extraIssueWindow({ ...base, today: "2026-10-10" })).toEqual({ open: false, nextLesson: "2026-10-09" });
  });
  it("학원 휴원일은 다음 수업이 아니다", () => {
    expect(extraIssueWindow({ ...base, today: "2026-10-12", isHoliday: (d) => d === "2026-10-09" })).toEqual({ open: true });
  });
  it("분리등원 — 그 학생이 안 오는 요일은 건너뛴다", () => {
    const tueOnly = { ...enrollment, attendance_days: ["tue"] };
    expect(extraIssueWindow({ ...base, enrollments: [tueOnly], today: "2026-10-12" })).toEqual({ open: true });
    expect(extraIssueWindow({ ...base, enrollments: [tueOnly], today: "2026-10-14" })).toEqual({ open: false, nextLesson: "2026-10-13" });
  });
  it("숙제일 이전·당일 기록은 다음 수업이 아니다 · 시간표에 없는 날 보강 기록도 다음 수업으로 본다", () => {
    expect(extraIssueWindow({ ...base, today: "2026-10-08", lessonDates: ["2026-10-01", "2026-10-06"] })).toEqual({ open: true });
    expect(extraIssueWindow({ ...base, today: "2026-10-08", lessonDates: ["2026-10-07"] })).toEqual({ open: false, nextLesson: "2026-10-07" });
  });
  it("배치의 유효 기간 밖 요일은 수업이 아니다", () => {
    expect(classMeetsOn([{ day_of_week: "fri", valid_from: "2026-10-10", valid_to: null }], "2026-10-09")).toBe(false);
    expect(classMeetsOn([{ day_of_week: "fri", valid_from: null, valid_to: "2026-10-09" }], "2026-10-09")).toBe(true);
  });
});
