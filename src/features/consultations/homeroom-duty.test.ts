import { describe, expect, it } from "vitest";
import { buildCounselDuty } from "./homeroom-duty";
import type { SnapshotClass, SnapshotEnrollment, SnapshotSchedule } from "../teacher-portfolio/model/types";

const cls = (id: string, teacher: string, subject = "math"): SnapshotClass => ({
  id, class_name: id, subject, english_track: null, teacher_id: teacher, is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false,
});
const slot = (classId: string, day: string): SnapshotSchedule => ({
  id: `${classId}-${day}`, class_id: classId, day_of_week: day, start_time: "16:00", end_time: "17:00",
  teacher_id: null, slot_teacher_label: null, lab_separate: false, valid_from: "2026-01-01", valid_to: null,
});
const enr = (student: string, classId: string, days: string[] | null = null): SnapshotEnrollment => ({
  id: `${student}-${classId}`, student_id: student, class_id: classId, start_date: "2026-03-01", end_date: null,
  on_hold: false, attendance_days: days, is_transferred: false, is_transferred_in: false,
});

const duty = (classes: SnapshotClass[], schedules: SnapshotSchedule[], enrollments: SnapshotEnrollment[], allHomerooms = false) =>
  buildCounselDuty({
    classes, schedules, enrollments, owner: (c) => c.teacher_id, allHomerooms: () => allHomerooms,
    teacherIds: classes.map((c) => c.teacher_id!), from: "2026-09-01", end: "2026-10-27",
  });

describe("buildCounselDuty — 가장 많은 요일을 듣는 반의 담임만", () => {
  const classes = [cls("화목", "a"), cls("월수금", "b")];
  const schedules = [slot("화목", "tue"), slot("화목", "thu"), slot("월수금", "mon"), slot("월수금", "wed"), slot("월수금", "fri")];

  it("화목 반에서 화요일만 듣고 다른 반에서 2일 들으면 화목 반 담임은 부담임", () => {
    const isDuty = duty(classes, schedules, [enr("s", "화목", ["tue"]), enr("s", "월수금", ["mon", "wed"])]);
    expect(isDuty("a", "s", "화목", "2026-10-27")).toBe(false);
    expect(isDuty("b", "s", "월수금", "2026-10-27")).toBe(true);
  });

  it("요일 수가 같으면 둘 다 담임", () => {
    const isDuty = duty(classes, schedules, [enr("s", "화목"), enr("s", "월수금", ["mon", "wed"])]);
    expect(isDuty("a", "s", "화목", "2026-10-27")).toBe(true);
    expect(isDuty("b", "s", "월수금", "2026-10-27")).toBe(true);
  });

  it("한 반만 다니면 요일이 하루여도 그 반 담임", () => {
    const isDuty = duty(classes, schedules, [enr("s", "화목", ["tue"])]);
    expect(isDuty("a", "s", "화목", "2026-10-27")).toBe(true);
  });

  it("다른 과목 반은 따로 센다", () => {
    const isDuty = duty([cls("화목", "a"), cls("영어", "e", "english")], [...schedules, slot("영어", "mon"), slot("영어", "wed")], [enr("s", "화목", ["tue"]), enr("s", "영어")]);
    expect(isDuty("a", "s", "화목", "2026-10-27")).toBe(true);
    expect(isDuty("e", "s", "영어", "2026-10-27")).toBe(true);
  });

  it("'수업 담당' 과목은 요일과 상관없이 반 담임 모두", () => {
    const isDuty = duty(classes, schedules, [enr("s", "화목", ["tue"]), enr("s", "월수금", ["mon", "wed"])], true);
    expect(isDuty("a", "s", "화목", "2026-10-27")).toBe(true);
  });
});
