import { describe, expect, it } from "vitest";
import { COURSE_BUCKETS, summarizeCourses } from "./course-count";
import type { ActiveEnrollmentRow } from "./enrolled-composition";

/** 상단 '강좌수'(원장 2026-10-20) — 재원생이 지금 듣는 반을 학생마다 모두 센다. */
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
  it("반마다 센다(같은 과목 둘이면 2 · 같은 반 두 줄은 1) · 프로그램별(심화도 수학 · 과학은 전체에만) · 학생당 강좌 수", () => {
    const rows = [
      row("1", "a", "jj", "math"),
      row("2", "a", "ms", "subject_1"),
      row("3", "a", "ms", "subject_1"), // 같은 반 두 줄
      row("4", "b", "e1", "english", { track: "eie" }),
      row("5", "b", "e2", "english"),
      row("6", "b", "m1", "math"),
      row("7", "b", "s1", "science"),
      row("8", "b", "s2", "science"),
      row("9", "c", "m1", "math", { start_date: "2026-11-02" }), // 아직 시작 전 — 세지 않는다
    ];
    const v = summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" });
    expect(v.total).toBe(7);
    // 세 숫자 잇기 — 반을 듣는 학생 2명 · 학생×과목 a(수학·심화) 2 + b(영어·수학·과학) 3 = 5 · 강좌 7(같은 과목 반 둘 = +2).
    expect([v.students, v.subjectSeats, v.noSubject]).toEqual([2, 5, 0]);
    expect(v.programs).toEqual({ eie: 1, injaewon: 1, math: 3 });
    expect(v.perStudent).toEqual([
      { courses: 1, students: 0 },
      { courses: 2, students: 1 },
      { courses: 3, students: 0 },
      { courses: COURSE_BUCKETS, students: 1 }, // b = 5개 → '4개 이상'
    ]);
    // 강좌 수마다 무엇으로 듣는지(원장 같은 날 *"2개를 어떤걸로 듣는지 전혀 모르잖아"*) — 칸마다 조합 인원의 합 = 그 칸 학생 수.
    expect(v.combos).toEqual([
      { bucket: 2, parts: [{ program: "math", count: 2 }], students: 1 },
      { bucket: 4, parts: [{ program: "eie", count: 1 }, { program: "injaewon", count: 1 }, { program: "math", count: 1 }, { program: "other", count: 2 }], students: 1 },
    ]);
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
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" }).total).toBe(4);
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-11-02" }).total).toBe(3); // a: 정규 · 특강 · 새 반
  });

  it("과목 관리자는 그 과목 반만 · 강사 스코프는 담당 학생만", () => {
    const rows = [row("1", "a", "m1", "math"), row("2", "a", "e1", "english"), row("3", "b", "m2", "math")];
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20", inSubject: (s) => s === "math" }).total).toBe(2);
    expect(summarizeCourses({ rows, scope: { studentIds: ["a"], subjects: [] }, subjects, today: "2026-10-20" }).total).toBe(2);
  });

  it("과목이 빈 반은 강좌수엔 들고 학생×과목엔 안 든다(따로 센다)", () => {
    const v = summarizeCourses({ rows: [row("1", "a", "m1", "math"), row("2", "a", "x", "")], scope: null, subjects, today: "2026-10-20" });
    expect([v.total, v.students, v.subjectSeats, v.noSubject]).toEqual([2, 1, 1, 1]);
  });

  it("반 id를 안 실은 옛 줄은 수강 줄마다 한 강좌", () => {
    const rows = [row("1", "a", "x", "math", { class_id: undefined }), row("2", "a", "x", "math", { class_id: undefined })];
    expect(summarizeCourses({ rows, scope: null, subjects, today: "2026-10-20" }).total).toBe(2);
  });
});
