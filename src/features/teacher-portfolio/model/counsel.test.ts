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
  it("교시만 들어가는 부담임(JJ)은 의무 없음 — 요일은 반 담당 몫 · 다른 과목은 따로", () => {
    const src = source([klass("A", "a"), klass("B", "b"), klass("E", "e", "english")],
      [slot("A", "mon"), slot("A", "tue", "jj"), slot("B", "wed"), slot("E", "thu")], [enroll("s", "A"), enroll("s", "B"), enroll("s", "E")]);
    // 수학: a = 월·화(화요일 교시는 JJ 부담임이 들어가도 A반 담당 몫) 2 · b = 수 1 → a만. JJ 부담임은 없음. 영어는 e 혼자.
    expect([...src.counselDutyOf("2026-10-31", "a", no).get("s") ?? []]).toEqual(["A"]);
    expect(src.counselDutyOf("2026-10-31", "b", no).size).toBe(0);
    expect(src.counselDutyOf("2026-10-31", "jj", no).size).toBe(0);
    expect(src.counselDutyOf("2026-10-31", "e", no).size).toBe(1);
    const tie = source([klass("A", "a"), klass("B", "b")], [slot("A", "mon"), slot("B", "fri")], [enroll("s", "A"), enroll("s", "B")]);
    expect(tie.counselDutyOf("2026-10-31", "a", no).size + tie.counselDutyOf("2026-10-31", "b", no).size).toBe(2);
  });
  it("보고서 미발송 반은 의무에서 빠진다 — 그런 반만 다니면 그 반 담당", () => {
    const optout = (id: string, teacher: string) => ({ ...klass(id, teacher), report_optout: true });
    const src = source([klass("A", "a"), optout("J", "j")], [slot("A", "mon"), slot("J", "tue"), slot("J", "wed")], [enroll("s", "A"), enroll("s", "J")]);
    expect(src.counselDutyOf("2026-10-31", "a", no).size).toBe(1);
    expect(src.counselDutyOf("2026-10-31", "j", no).size).toBe(0);
    const only = source([optout("J", "j")], [slot("J", "tue")], [enroll("s", "J")]);
    expect(only.counselDutyOf("2026-10-31", "j", no).size).toBe(1);
  });
});

describe("영어는 기본이 수업 담당(원장 2026-10-19)", () => {
  it("저장값이 없으면 영어만 수업 담당 · 저장값이 있으면 그대로", async () => {
    const { counselByClassTeacher } = await import("@/features/owner/subjects");
    expect(counselByClassTeacher({ key: "english" })).toBe(true);
    expect(counselByClassTeacher({ key: "math" })).toBe(false);
    expect(counselByClassTeacher({ key: "english", counselAllHomerooms: false })).toBe(false);
    expect(counselByClassTeacher({ key: "math", counselAllHomerooms: true })).toBe(true);
  });
  it("영어 반: 원어민이 교시를 더 많이 맡아도 상담 의무는 반의 담당", () => {
    const d = { consultations: [], settings: { subjects: [{ key: "english", label: "영어" }] } } as unknown as PortfolioSnapshot;
    const seen: boolean[] = [];
    counselItem({ d, teacherId: "t", w, classNameOf: (id) => id, duty: (_day, _t, all) => { seen.push(all("english"), all("math")); return new Map(); } });
    expect(seen).toEqual([true, false]);
  });
});
