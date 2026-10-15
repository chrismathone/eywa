import { describe, expect, it } from "vitest";
import { DEFAULT_GRADES_OPTIONS } from "../evaluation/options";
import { buildRecordOwners } from "./attribution";
import { buildGrades, type GradeTarget } from "./grades";
import type { SnapshotGrade } from "./source-types";
import type { ChurnSource } from "./students";
import type { SnapshotClass, SnapshotEnrollment } from "./types";

/** 성적 관리 — 점수율 시험은 그날 다니던 반 담임에게 · 일일테스트 = 제출률 · 월말평가 = 응시율 · 종류별 값을 비중으로 가중 평균(원장 결정 10 · 2026-10-15). */
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
  id: `g${++n}`, student_id: student, subject: "math", class_id: null, day, entered: day, kind: "check", score, max, ...over,
});
const classes = new Map([cls("m1", "math", "t1"), cls("m2", "math", "t2"), cls("e1", "english", "t3"), cls("pool", "math", "t9", { is_makeup_pool: true })].map((c) => [c.id, c]));
// 담임 이력 — m1은 10/15부터 t4.
const owner = (c: SnapshotClass, day: string) => (c.id === "m1" && day >= "2026-10-15" ? "t4" : c.teacher_id);
const run = (grades: SnapshotGrade[], enrollments: SnapshotEnrollment[], teacher: string, opts = DEFAULT_GRADES_OPTIONS, cutoff = "2026-10-31",
  extra: { targets?: GradeTarget[]; rosterOf?: ChurnSource["rosterOf"] } = {}, all: SnapshotClass[] = [...classes.values()]) =>
  buildGrades({ grades, ownersOf: buildRecordOwners({ enrollments, classes, owner }), classes: new Map(all.map((c) => [c.id, c])), rosterOf: extra.rosterOf ?? (() => new Map()) })(
    teacher, w, cutoff, opts, (id) => classes.get(id)?.class_name ?? "", extra.targets);
/** 그날 강사별 명단 — 월말평가 응시율이 그 달 마지막 날 담임 반을 읽는다(필요한 칸만). */
const roster = (byDay: Record<string, Record<string, Record<string, string[]>>>): ChurnSource["rosterOf"] => (date, teacher) =>
  new Map(Object.entries(byDay[date]?.[teacher] ?? {}).map(([student, home]) => [student, { classes: new Set(home), homeClasses: new Set(home), roles: new Set(["담임" as const]) }]));
const t = (studentId: string, date: string, ...classIds: string[]): GradeTarget => ({ studentId, day: date, classIds });

describe("성적 관리", () => {
  it("보고서 시험은 그 반, 반이 없는 성적은 그날 그 과목으로 다니던 반의 그날 담임에게 간다", () => {
    const grades = [g("a", "2026-10-05", 8, 10, { class_id: "m1" }), g("a", "2026-10-20", 6, 10, { class_id: "m1" }), g("b", "2026-10-06", 90, 100, { kind: "school" })];
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
  it("점수율 종류는 종류별 평균을 비중으로 가중 평균 — 비중 0은 안 센다 · 학생 줄은 시험 수·평균·종류", () => {
    const enrollments = [enr("a", "m1"), enr("b", "m1")];
    const grades = [
      g("a", "2026-10-02", 10, 10), g("b", "2026-10-03", 5, 10), // 확인 평균 75
      g("a", "2026-10-07", 60, 100, { kind: "school" }), // 학교 60
      g("b", "2026-10-08", 0, 10, { kind: "other" }),
    ];
    const weights = { daily: 1, check: 1, monthly: 1, school: 3, other: 0 };
    const m = run(grades, enrollments, "t1", { weights });
    expect(m.raw).toBe(63.8); // (75×1 + 60×3) / 4 = 63.75 → 63.8
    expect(m.kinds.map((k) => [k.kind, k.measure, k.count, k.average])).toEqual([["check", "score", 2, 75], ["school", "score", 1, 60]]);
    expect(m.detail.find((r) => r.studentId === "a")).toMatchObject({ tests: 2, average: 80, kinds: "확인테스트 1 · 내신 1", className: "m1반" });
  });
  it("일일테스트 = 제출률 — 보고서 대상 칸 중 그날 그 과목 기록이 있는 칸(점수·입력한 사람은 안 본다) · 그 시험을 안 하는 과목은 대상 아님", () => {
    const grades = [
      g("a", "2026-10-02", 0, 10, { kind: "daily", class_id: "m2" }), // 0점이어도 · 다른 반에 적혀도 제출
      g("b", "2026-10-02", 9, 10, { kind: "daily" }),
      g("a", "2026-10-03", 9, 10, { kind: "daily", entered: "2026-11-02" }), // 마감 뒤 입력 — 미제출
      g("b", "2026-10-03", 9, 10, { kind: "daily", subject: "subject_1" }), // 다른 과목 기록 — 미제출
    ];
    const targets = [t("a", "2026-10-02", "m1"), t("a", "2026-10-03", "m1"), t("b", "2026-10-02", "m1"), t("b", "2026-10-03", "m1"), t("b", "2026-10-04", "e1")];
    const m = run(grades, [enr("a", "m1"), enr("b", "m1")], "t1", DEFAULT_GRADES_OPTIONS, "2026-10-31", { targets });
    // 영어(e1)는 학원에 일일테스트 기록이 없어 대상이 아니다 — 수학 칸 4개 중 2개 제출.
    expect(m.kinds).toEqual([{ kind: "daily", measure: "submit", count: 4, done: 2, average: 50, weight: 1 }]);
    expect(m.raw).toBe(50);
    expect(m.detail.map((r) => [r.studentId, r.daily, r.tests, r.average])).toEqual([["a", { done: 1, total: 2 }, 0, null], ["b", { done: 1, total: 2 }, 0, null]]);
    expect(run(grades, [], "t1", { weights: { ...DEFAULT_GRADES_OPTIONS.weights, daily: 0 } }, "2026-10-31", { targets }).raw).toBeNull();
  });
  it("월말평가 = 응시율 — 그 달 마지막 날 담임 반 명단(특강·그 달 그 시험이 없는 과목 제외) 학생 중 그 달 월말평가를 본 학생", () => {
    const sp = cls("sp", "math", "t1", { is_special: true });
    const all = [...classes.values(), sp];
    // 10/31 명단 — t1 담임: a·c(m1) · d(특강) · e(영어). b는 달 중간에 떠나 없다 · f는 t2 반.
    const rosterOf = roster({ "2026-10-31": { t1: { a: ["m1"], c: ["m1"], d: ["sp"], e: ["e1"] }, t2: { f: ["m2"] } } });
    const grades = [
      g("a", "2026-10-28", 40, 100, { kind: "monthly" }), g("c", "2026-09-29", 80, 100, { kind: "monthly" }), // c는 지난달 — 이 달 미응시
      g("b", "2026-10-28", 70, 100, { kind: "monthly" }), g("e", "2026-10-28", 80, 100, { kind: "school", subject: "english" }),
    ];
    const m = run(grades, [], "t1", DEFAULT_GRADES_OPTIONS, "2026-10-31", { rosterOf }, all);
    expect(m.kinds).toEqual([{ kind: "monthly", measure: "take", count: 2, done: 1, average: 50, weight: 1 }]);
    expect(m.detail.map((r) => [r.studentId, r.monthly])).toEqual([["a", true], ["c", false]]);
    // 그 달 학원에 월말평가 기록이 하나도 없으면(지난달 것뿐) 월말평가는 대상이 아니다 — 0%가 아니라 빠진다.
    expect(run([grades[1]], [], "t1", DEFAULT_GRADES_OPTIONS, "2026-10-31", { rosterOf }, all).raw).toBeNull();
  });
  it("일일테스트도 특강 반과 그 달 기록이 없는 과목은 대상이 아니다", () => {
    const sp = cls("sp", "math", "t1", { is_special: true });
    const targets = [t("a", "2026-10-02", "m1"), t("a", "2026-10-03", "sp")];
    const grades = [g("a", "2026-10-02", 1, 10, { kind: "daily" }), g("z", "2026-09-30", 1, 10, { kind: "daily", subject: "english" })];
    const m = run(grades, [], "t1", DEFAULT_GRADES_OPTIONS, "2026-10-31", { targets: [...targets, t("a", "2026-10-04", "e1")] }, [...classes.values(), sp]);
    // 특강 칸 · 영어 칸(영어 일일테스트는 9월 기록뿐) 제외 — 수학 칸 1개 중 1개.
    expect(m.kinds).toEqual([{ kind: "daily", measure: "submit", count: 1, done: 1, average: 100, weight: 1 }]);
  });
  it("다른 달 시험과 마감 뒤에 입력한 시험은 세지 않는다 · 시험이 없으면 자료 없음", () => {
    // 10/15부터 m1 담임은 t4 — 9/30 시험은 그 달 밖, 10/31 시험은 11/2에 입력(마감 뒤).
    const enrollments = [enr("a", "m1")];
    expect(run([g("a", "2026-09-30", 10, 10), g("a", "2026-10-31", 9, 10, { entered: "2026-11-02" })], enrollments, "t4").raw).toBeNull();
    expect(run([g("a", "2026-10-31", 9, 10, { entered: null })], enrollments, "t4").raw).toBe(90);
  });
});
