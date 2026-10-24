import { describe, expect, it } from "vitest";
import { COURSE_BUCKETS, summarizeCourses } from "./course-count";
import type { ActiveEnrollmentRow } from "./enrolled-composition";

/** 상단 '강좌수'(원장 2026-10-20) — 재원생이 듣는 과목을 학생마다 한 번 센다. */
const subjects = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "science", label: "과학" },
];
const row = (id: string, student: string, classId: string, subject: string, o: Partial<ActiveEnrollmentRow> & { track?: string } = {}): ActiveEnrollmentRow => ({
  id,
  student_id: student,
  class_id: classId,
  start_date: "2026-03-02",
  class: { subject, english_track: o.track ?? null },
  ...o,
});

describe("summarizeCourses — 상단 '강좌수'", () => {
  it("수학 반 5개 + 영어(두 프로그램) + 과학 = 학생당 3개 · 다른 학생은 별도로 센다", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`m${i}`, "a", `m${i}`, i === 4 ? "subject_1" : "math")),
      row("e1", "a", "e1", "english", { track: "eie" }), row("e2", "a", "e2", "english"),
      row("s1", "a", "s1", "science"), row("s2", "a", "s2", "science"),
      row("b1", "b", "m0", "math"), row("b2", "b", "m1", "math"),
      row("future", "c", "m0", "math", { start_date: "2026-11-02" }),
    ];
    const v = summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" });
    expect(v.total).toBe(4);
    expect(v.students).toBe(2);
    expect(v.subjects).toEqual({ math: 2, english: 1, science: 1 });
    expect(Object.values(v.subjects).reduce((a, b) => a + b, 0)).toBe(v.total);
    expect(v.perStudent).toEqual([{ courses: 1, students: 1 }, { courses: 2, students: 0 }, { courses: 3, students: 1 }, { courses: COURSE_BUCKETS, students: 0 }]);
    expect(v.combos).toEqual([
      { bucket: 1, parts: [{ subject: "math", count: 1 }], students: 1 },
      { bucket: 3, parts: [{ subject: "english", count: 1 }, { subject: "math", count: 1 }, { subject: "science", count: 1 }], students: 1 },
    ]);
    expect(summarizeCourses({ rows: [...rows].reverse(), scope: null, subjects, today: "2026-10-20" })).toEqual(v);
  });

  it("🔴 종료일이 미래로 적힌 수강(특강 기간 · 반이동 예약 전의 원래 반)은 그날까지 센다 · 오늘 끝나는 일반 수강도 오늘은 센다 · 반이동은 그날부터 새 반만", () => {
    const rows = [
      row("1", "a", "reg", "math"),
      row("2", "a", "sp", "math", { end_date: "2026-11-14" }), // 특강 — 종료일이 미리 적혔다
      row("3", "a", "old", "english", { end_date: "2026-11-02", is_transferred: true }), // 11/2에 옮겨 갈 원래 반
      row("4", "a", "new", "english", { start_date: "2026-11-02" }), // 옮겨 갈 반(아직 시작 전)
      row("5", "b", "last", "math", { end_date: "2026-10-20" }), // 오늘 끝나는 일반 수강
      row("6", "b", "moved", "math", { end_date: "2026-10-20", is_transferred: true }), // 오늘 옮겨 간 원래 반 — 오늘은 새 반
    ];
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" }).total).toBe(3);
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-11-02" }).total).toBe(2); // a: 수학 · 영어
  });

  it("과목 관리자는 그 과목 반만 · 강사 스코프는 담당 학생만", () => {
    const rows = [row("1", "a", "m1", "math"), row("2", "a", "e1", "english"), row("3", "b", "m2", "math")];
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20", inSubject: (s) => s === "math" }).total).toBe(2);
    expect(summarizeCourses({ rows, scope: { studentIds: ["a"], subjects: [] }, subjects, today: "2026-10-20" }).total).toBe(2);
  });

  it("과목이 빈 반은 과목 수에 넣지 않는다", () => {
    const v = summarizeCourses({ rows: [row("1", "a", "m1", "math"), row("2", "a", "x", "")], scope: null, subjects, today: "2026-10-20" });
    expect([v.total, v.students, v.subjects]).toEqual([1, 1, { math: 1 }]);
  });

  it("반 id 유무와 관계없이 같은 과목은 한 번", () => {
    const rows = [row("1", "a", "x", "math", { class_id: undefined }), row("2", "a", "x", "math", { class_id: undefined })];
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" }).total).toBe(1);
  });
});
