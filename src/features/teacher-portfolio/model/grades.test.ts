import { describe, expect, it } from "vitest";
import { DEFAULT_GRADES_OPTIONS } from "../evaluation/options";
import { buildRecordOwners } from "./attribution";
import { buildGrades } from "./grades";
import type { SnapshotGrade } from "./source-types";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

/** 성적 관리 — 그날 다니던 반 담임에게 · 종류별 평균을 비중으로 가중 평균(원장 결정 10). */
const w = { month: "2026-10", start: "2026-10-01", end: "2026-10-31", partial: false };
const cls = (id: string, subject: string, teacher: string, over: Partial<SnapshotClass> = {}): SnapshotClass => ({
  id, class_name: `${id}반`, subject, english_track: null, teacher_id: teacher, is_active: true, closed_at: null, report_optout: null, is_makeup_pool: null, ...over,
});
const enr = (student: string, classId: string, start = "2026-09-01", end: string | null = null, transferred = false): SnapshotEnrollment => ({
  id: `${student}|${classId}|${start}`, student_id: student, class_id: classId, start_date: start, end_date: end, on_hold: false, attendance_days: null,
  is_transferred: transferred, is_transferred_in: false,
});
let n = 0;
const g = (student: string, day: string, score: number, max: number, over: Partial<SnapshotGrade> = {}): SnapshotGrade => ({
  id: `g${++n}`, student_id: student, subject: "math", class_id: null, day, entered: day, kind: "daily", score, max, ...over,
});
const classes = new Map([cls("m1", "math", "t1"), cls("m2", "math", "t2"), cls("e1", "english", "t3"), cls("pool", "math", "t9", { is_makeup_pool: true })].map((c) => [c.id, c]));
// 담임 이력 — m1은 10/15부터 t4.
const owner = (c: SnapshotClass, day: string) => (c.id === "m1" && day >= "2026-10-15" ? "t4" : c.teacher_id);
const run = (grades: SnapshotGrade[], enrollments: SnapshotEnrollment[], teacher: string, opts = DEFAULT_GRADES_OPTIONS, cutoff = "2026-10-31") =>
  buildGrades({ grades, ownersOf: buildRecordOwners({ enrollments, classes, owner }) })(teacher, w, cutoff, opts, (id) => classes.get(id)?.class_name ?? "");

describe("성적 관리", () => {
  it("보고서 시험은 그 반, 반이 없는 성적은 그날 그 과목으로 다니던 반의 그날 담임에게 간다", () => {
    const grades = [g("a", "2026-10-05", 8, 10, { class_id: "m1" }), g("a", "2026-10-20", 6, 10, { class_id: "m1" }), g("b", "2026-10-06", 90, 100, { kind: "monthly" })];
    const enrollments = [enr("a", "m1"), enr("b", "m2"), enr("b", "e1")];
    expect(run(grades, enrollments, "t1")).toMatchObject({ raw: 80, tests: 1, students: 1 });
    // 10/15부터 m1 담임은 t4 — 10/20 시험은 t4 몫.
    expect(run(grades, enrollments, "t4")).toMatchObject({ raw: 60, tests: 1 });
    // b의 수학 성적은 다니던 수학 반(m2) 담임에게만 — 영어 반 담임에겐 안 간다.
    expect(run(grades, enrollments, "t2")).toMatchObject({ raw: 90, tests: 1 });
    expect(run(grades, enrollments, "t3").raw).toBeNull();
  });
  it("보강 반·다른 과목 반에 적힌 성적은 그날 다니던 그 과목 정규 반으로 · 반을 옮긴 날은 새 반", () => {
    const enrollments = [enr("a", "m1", "2026-09-01", "2026-10-10", true), enr("a", "m2", "2026-10-10")];
    const grades = [g("a", "2026-10-09", 5, 10, { class_id: "pool" }), g("a", "2026-10-10", 7, 10, { class_id: "e1" })];
    expect(run(grades, enrollments, "t1")).toMatchObject({ raw: 50, tests: 1 });
    expect(run(grades, enrollments, "t2")).toMatchObject({ raw: 70, tests: 1 });
  });
  it("종류별 평균을 비중으로 가중 평균 — 비중 0은 안 센다 · 학생 줄은 시험 수·평균·종류", () => {
    const enrollments = [enr("a", "m1"), enr("b", "m1")];
    const grades = [
      g("a", "2026-10-02", 10, 10), g("b", "2026-10-03", 5, 10), // 일일 평균 75
      g("a", "2026-10-07", 60, 100, { kind: "monthly" }), // 월말 60
      g("b", "2026-10-08", 0, 10, { kind: "check" }),
    ];
    const weights = { daily: 1, check: 0, monthly: 3, school: 1, other: 1 };
    const m = run(grades, enrollments, "t1", { weights });
    expect(m.raw).toBe(63.8); // (75×1 + 60×3) / 4 = 63.75 → 63.8
    expect(m.kinds.map((k) => [k.kind, k.count, k.average])).toEqual([["daily", 2, 75], ["monthly", 1, 60]]);
    expect(m.detail.find((r) => r.studentId === "a")).toMatchObject({ tests: 2, average: 80, kinds: "일일테스트 1 · 월말평가 1", className: "m1반" });
  });
  it("다른 달 시험과 마감 뒤에 입력한 시험은 세지 않는다 · 시험이 없으면 자료 없음", () => {
    // 10/15부터 m1 담임은 t4 — 9/30 시험은 그 달 밖, 10/31 시험은 11/2에 입력(마감 뒤).
    const enrollments = [enr("a", "m1")];
    expect(run([g("a", "2026-09-30", 10, 10), g("a", "2026-10-31", 9, 10, { entered: "2026-11-02" })], enrollments, "t4").raw).toBeNull();
    expect(run([g("a", "2026-10-31", 9, 10, { entered: null })], enrollments, "t4").raw).toBe(90);
  });
});
