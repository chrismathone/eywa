import { describe, expect, it } from "vitest";
import { blankLessonDates, blankLessonDayError, classMeetsOn, extraIssueLessonError, extraIssueWindow, nextLessonDate } from "./issue-window";

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

// 원장 2026-10-15 — 영상 숙제 마감 '다음 수업' = 시간표상 그 학생의 다음 수업일(휴원일 제외 · 14일 안). 저장 때 서버가 정한다(report-due.ts).
describe("영상 숙제 마감 — 다음 수업일", () => {
  const base = { schedules, enrollments: [enrollment], isHoliday: none };
  it("화요일 숙제 → 금요일 · 금요일 숙제 → 다음 화요일(그날은 빼고 뒤에서 찾는다)", () => {
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06" })).toBe("2026-10-09");
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-09" })).toBe("2026-10-13");
  });
  it("휴원일은 건너뛴다 · 분리 등원(그 요일만 오는 학생)은 오는 요일만", () => {
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", isHoliday: (d) => d === "2026-10-09" })).toBe("2026-10-13");
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", enrollments: [{ ...enrollment, attendance_days: ["tue"] }] })).toBe("2026-10-13");
  });
  it("14일 안에 수업이 없으면(수강 끝 · 시간표 끝 · 긴 휴원) null — 호출부가 7일로 둔다", () => {
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", enrollments: [{ ...enrollment, end_date: "2026-10-07" }] })).toBeNull();
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", schedules: [{ ...schedules[0], valid_to: "2026-10-06" }] })).toBeNull();
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", isHoliday: (d) => d <= "2026-10-20" })).toBeNull();
    // 14일째(10/20 화)는 들어간다
    expect(nextLessonDate({ ...base, homeworkDate: "2026-10-06", isHoliday: (d) => d < "2026-10-20" })).toBe("2026-10-20");
  });
});

// 원장 2026-10-22 '숙제없음 칸에 바로 배정' — 이미 올라온 영상을 그 학생이 실제로 들은 수업에 붙인다. 출제 기한(다음 수업 전)은 보지 않는다.
describe("숙제없음 수업일 — 영상을 붙일 수 있는 날", () => {
  const row = (session_date: string, status: string, recorded_at = `${session_date}T10:00:00Z`) =>
    ({ id: `${session_date}:${status}:${recorded_at}`, student_id: "s", class_id: "c", session_date, slot_start: "16:00", status, recorded_at });
  const base = { schedules, enrollments: [enrollment], isHoliday: none };
  it("들은 수업일만 날짜순으로 — 결석 · 수업 없는 요일 · 수강 전은 빠진다", () => {
    expect(blankLessonDates({ ...base, fromDate: "2026-10-05", toDate: "2026-10-13", records: [row("2026-10-09", "absent")] }))
      .toEqual(["2026-10-06", "2026-10-13"]);
    expect(blankLessonDates({ ...base, enrollments: [{ ...enrollment, start_date: "2026-10-10" }], fromDate: "2026-10-05", toDate: "2026-10-13", records: [] }))
      .toEqual(["2026-10-13"]);
  });
  it("🔑 다음 수업이 지났어도 붙일 수 있다(따로 내는 숙제의 기한과 다르다) · 이미 숙제가 있는 날은 숙제 칸으로 고르므로 뺀다", () => {
    const records = [row("2026-10-06", "present"), row("2026-10-09", "present"), row("2026-10-13", "present")];
    expect(blankLessonDates({ ...base, fromDate: "2026-10-06", toDate: "2026-10-13", records, exclude: new Set(["2026-10-09"]) }))
      .toEqual(["2026-10-06", "2026-10-13"]);
  });
  it("출결 없는 학원 휴원일은 빠지고, 그날 출석이 찍혔으면(보충 수업) 붙일 수 있다", () => {
    const isHoliday = (d: string) => d === "2026-10-09";
    expect(blankLessonDates({ ...base, isHoliday, fromDate: "2026-10-09", toDate: "2026-10-09", records: [] })).toEqual([]);
    expect(blankLessonDates({ ...base, isHoliday, fromDate: "2026-10-09", toDate: "2026-10-09", records: [row("2026-10-09", "present")] })).toEqual(["2026-10-09"]);
  });
  it("결석을 출석으로 정정했으면 최신본을 따른다 · 결석 교시에 보강 기록이 함께 있어도 결석이다(숙제없음 칸과 같은 판정)", () => {
    expect(blankLessonDates({ ...base, fromDate: "2026-10-06", toDate: "2026-10-06",
      records: [row("2026-10-06", "absent", "2026-10-06T10:00:00Z"), row("2026-10-06", "present", "2026-10-06T11:00:00Z")] })).toEqual(["2026-10-06"]);
    expect(blankLessonDates({ ...base, fromDate: "2026-10-06", toDate: "2026-10-06",
      records: [row("2026-10-06", "absent"), { ...row("2026-10-06", "makeup"), slot_start: "18:00" }] })).toEqual([]);
  });
  it("종강 뒤 날은 출결이 없으면 수업일이 아니다", () => {
    expect(blankLessonDates({ ...base, closedOn: "2026-10-09", fromDate: "2026-10-06", toDate: "2026-10-13", records: [] })).toEqual(["2026-10-06", "2026-10-09"]);
    expect(blankLessonDayError({ ...base, closedOn: "2026-10-09", date: "2026-10-13", records: [] })).toMatch("수업이 없었습니다");
  });
  it("하루 판정은 까닭을 말한다 — 저장 검증이 쓴다", () => {
    expect(blankLessonDayError({ ...base, date: "2026-10-06", records: [row("2026-10-06", "absent")] })).toMatch("결석");
    expect(blankLessonDayError({ ...base, date: "2026-10-07", records: [] })).toMatch("수업이 없었습니다");
    expect(blankLessonDayError({ ...base, date: "2026-10-06", records: [], isHoliday: (d) => d === "2026-10-06" })).toMatch("휴원일");
    expect(blankLessonDayError({ ...base, date: "2026-10-06", records: [] })).toBeNull();
  });
});
