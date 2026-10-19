import { describe, expect, it } from "vitest";
import { counselItem } from "./counsel";
import { buildStudentTracking } from "./students";
import type { PortfolioSnapshot, SnapshotClass, SnapshotConsultation, SnapshotEnrollment, SnapshotSchedule } from "./types";

/** 원생상담 — 상담 의무 학생 중 본인이 이 달에 1회 이상 상담한 비율(원장 2026-10-14 · 의무 = 가장 많은 요일 2026-10-19). */
const w = { month: "2026-10", start: "2026-10-01", end: "2026-10-31", partial: false };
const consult = (student: string, at: string, counselor = "t"): SnapshotConsultation => ({
  id: `${student}|${at}|${counselor}`, student_id: student, counselor_id: counselor, consulted_at: at, follow_up_date: null, follow_up_done: null, updated_at: null,
});
const run = (consultations: SnapshotConsultation[], students = ["a", "b", "c", "d"]) => counselItem({
  d: { consultations, settings: { subjects: [] } } as unknown as PortfolioSnapshot, teacherId: "t", w, classNameOf: (id) => id,
  duty: () => new Map(students.map((s) => [s, new Set(["c1"])])),
});

describe("원생상담 = 의무 학생 상담 비율", () => {
  it("전원 1회 이상이면 100%, 여러 번 상담해도 한 명 · 다른 사람이 한 상담·다른 달 상담은 세지 않는다", () => {
    expect(run(["a", "b", "c", "d"].map((s) => consult(s, "2026-10-05T01:00:00Z"))).raw).toBe(100);
    const m = run([
      consult("a", "2026-10-05T01:00:00Z"), consult("a", "2026-10-20T01:00:00Z"),
      consult("b", "2026-10-06T01:00:00Z", "other"), consult("c", "2026-09-30T14:00:00Z"), consult("d", "2026-09-30T15:00:00Z"),
    ]);
    expect([m.consulted, m.total, m.raw]).toEqual([2, 4, 50]);
    expect(m.detail.find((r) => r.studentId === "a")?.day).toBe("2026-10-05");
    expect(m.detail[0].consulted).toBe(false);
  });
  it("의무 학생이 없으면 자료 없음", () => {
    expect(run([], []).raw).toBeNull();
  });
});

describe("상담 의무 = 같은 과목에서 가장 많은 요일을 맡은 선생님만(원장 2026-10-19)", () => {
  const klass = (id: string, teacher: string, subject = "math"): SnapshotClass => ({
    id, class_name: id, subject, english_track: null, teacher_id: teacher, is_active: true, closed_at: null, report_optout: false, is_makeup_pool: false,
  });
  const slot = (classId: string, day: string, teacher: string | null = null): SnapshotSchedule => ({
    id: `${classId}-${day}-${teacher}`, class_id: classId, day_of_week: day, start_time: "16:00", end_time: "17:00",
    teacher_id: teacher, slot_teacher_label: null, lab_separate: false, valid_from: "2026-01-01", valid_to: null,
  });
  const enroll = (student: string, classId: string): SnapshotEnrollment => ({
    id: `${student}-${classId}`, student_id: student, class_id: classId, start_date: "2026-09-01", end_date: null, on_hold: false,
    attendance_days: [], is_transferred: false, is_transferred_in: false, withdrawal_reason: null,
  });
  const source = (classes: SnapshotClass[], schedules: SnapshotSchedule[], enrollments: SnapshotEnrollment[]) =>
    buildStudentTracking({ from: "2026-10-01", end: "2026-10-31", classes, schedules, enrollments, owner: (c) => c.teacher_id }).churnSource;
  const no = () => false;

  it("주 3회 중 2회 a · 1회 b면 a만 — b는 의무 없음 · '담임 모두' 과목은 종전대로 둘 다", () => {
    const src = source([klass("A", "a"), klass("B", "b")], [slot("A", "mon"), slot("A", "wed"), slot("B", "fri")], [enroll("s", "A"), enroll("s", "B")]);
    expect([...src.counselDutyOf("2026-10-31", "a", no).keys()]).toEqual(["s"]);
    expect(src.counselDutyOf("2026-10-31", "b", no).size).toBe(0);
    expect(src.counselDutyOf("2026-10-31", "b", () => true).size).toBe(1);
  });
  it("요일 수가 같으면 둘 다 · 교시 담당은 그 요일의 선생님으로 센다 · 다른 과목은 따로", () => {
    const src = source([klass("A", "a"), klass("B", "b"), klass("E", "e", "english")],
      [slot("A", "mon"), slot("A", "tue", "b"), slot("B", "wed"), slot("E", "thu")], [enroll("s", "A"), enroll("s", "B"), enroll("s", "E")]);
    // 수학: a = 월 1 · b = 화(교시 담당) + 수 = 2 → b만. 영어는 e 혼자.
    expect(src.counselDutyOf("2026-10-31", "a", no).size).toBe(0);
    expect([...src.counselDutyOf("2026-10-31", "b", no).get("s") ?? []].sort()).toEqual(["A", "B"]);
    expect(src.counselDutyOf("2026-10-31", "e", no).size).toBe(1);
    const tie = source([klass("A", "a"), klass("B", "b")], [slot("A", "mon"), slot("B", "fri")], [enroll("s", "A"), enroll("s", "B")]);
    expect(tie.counselDutyOf("2026-10-31", "a", no).size + tie.counselDutyOf("2026-10-31", "b", no).size).toBe(2);
  });
});
