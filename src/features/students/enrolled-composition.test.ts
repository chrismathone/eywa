import { describe, expect, it } from "vitest";
import type { Program } from "./program";
import {
  OTHER_GRADE_LABEL,
  composeEnrolled,
  concurrentShare,
  enrolledSubjectCounts,
  gradeSplit,
  notYetStartedStudentIds,
  subjectMixOf,
  summarizePrograms,
  type ActiveEnrollmentRow,
} from "./enrolled-composition";

const programs = (entries: [string, Program[]][]) =>
  new Map(entries.map(([id, list]) => [id, new Set(list)]));

const SUBJECTS = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "science", label: "과학" },
];
let enrollmentSeq = 0;
const enr = (studentId: string, subject: string, track: string | null = null): ActiveEnrollmentRow => {
  enrollmentSeq += 1;
  return { id: `e${enrollmentSeq}`, student_id: studentId, class: { subject, english_track: track } };
};

describe("composeEnrolled · enrolledSubjectCounts — 한 번 받은 행으로 두 집계", () => {
  const rows = [
    enr("a", "english", "eie"),
    enr("a", "math"),
    enr("b", "english", null),
    enr("c", "subject_1"),
    enr("c", "math"),
    enr("d", "science"),
  ];
  const students = ["a", "b", "c", "d", "e"].map((id) => ({ id, grade: "중1", school: null }));

  it("프로그램(programOf) · 활성 수강 · 명단 — 학원 전체", () => {
    const out = composeEnrolled({ students, rows, scope: null, subjects: SUBJECTS });
    expect([...(out.programs.get("a") ?? [])].sort()).toEqual(["eie", "math"]);
    expect([...(out.programs.get("b") ?? [])]).toEqual(["injaewon"]);
    expect([...(out.programs.get("c") ?? [])]).toEqual(["math"]); // 수학(심화) + 수학 = 수학 하나
    expect(out.programs.has("d")).toBe(false);
    expect([...out.active].sort()).toEqual(["a", "b", "c", "d"]);
    expect(out.students).toHaveLength(5);
  });

  it("강사 스코프 — 담당 학생만, 표시 축(담당 과목)으로 좁힌다", () => {
    const scope = { studentIds: ["a", "c"], subjects: ["math"] };
    const out = composeEnrolled({ students, rows, scope, subjects: SUBJECTS });
    expect(out.students.map((s) => s.id)).toEqual(["a", "c"]);
    expect([...(out.programs.get("a") ?? [])]).toEqual(["math"]); // 영어는 축 밖
    expect(out.programs.has("c")).toBe(true);
    const counts = enrolledSubjectCounts(rows, scope);
    expect(counts.bySubject).toEqual({ math: 2 });
  });

  it("과목별은 distinct 학생 — 같은 과목 두 반도 한 명", () => {
    const counts = enrolledSubjectCounts([...rows, enr("a", "math")], null);
    expect(counts.bySubject).toEqual({ english: 2, math: 2, subject_1: 1, science: 1 });
    expect(counts.combinations.reduce((sum, g) => sum + g.value, 0)).toBe(4);
  });
});

describe("subjectMixOf — 영어·수학 두 축", () => {
  it("EiE·인재원 영어는 둘 다 '영어'", () => {
    expect(subjectMixOf(new Set<Program>(["eie"]))).toBe("englishOnly");
    expect(subjectMixOf(new Set<Program>(["injaewon"]))).toBe("englishOnly");
    expect(subjectMixOf(new Set<Program>(["eie", "injaewon"]))).toBe("englishOnly");
  });
  it("영어 + 수학 = both, 수학만 = mathOnly, 없음 = neither", () => {
    expect(subjectMixOf(new Set<Program>(["injaewon", "math"]))).toBe("both");
    expect(subjectMixOf(new Set<Program>(["math"]))).toBe("mathOnly");
    expect(subjectMixOf(new Set<Program>())).toBe("neither");
    expect(subjectMixOf(undefined)).toBe("neither");
  });
});

describe("summarizePrograms — 재원생 팝업", () => {
  const map = programs([
    ["a", ["eie", "math"]],
    ["b", ["injaewon"]],
    ["c", ["math"]],
    ["d", []],
  ]);
  const active = new Set(["a", "b", "c", "d"]);

  it("겹치는 학생은 프로그램마다 센다 — 합이 재원생보다 클 수 있다", () => {
    const out = summarizePrograms(["a", "b", "c", "d", "e"], map, active);
    expect(out).toMatchObject({ eie: 1, injaewon: 1, math: 2, both: 1 });
    expect(out.eie + out.injaewon + out.math).toBeGreaterThan(3);
  });

  it("수강 없음 = 활성 수강 0 · 그 외 과목만 = 활성 수강은 있으나 프로그램 없음", () => {
    const out = summarizePrograms(["a", "b", "c", "d", "e"], map, active);
    expect(out.noEnrollment).toBe(1); // e
    expect(out.otherOnly).toBe(1); // d(국어만 등)
  });

  it("명단 밖 학생은 세지 않고, 중복 id는 한 번만", () => {
    const out = summarizePrograms(["a", "a", "b"], map, active);
    expect(out).toEqual({ eie: 1, injaewon: 1, math: 1, both: 1, noEnrollment: 0, otherOnly: 0 });
  });
});

describe("concurrentShare — 동시 수강 %", () => {
  it("반올림, 재원생 0명이면 null(0으로 나누지 않는다)", () => {
    expect(concurrentShare(1, 3)).toBe(33);
    expect(concurrentShare(2, 3)).toBe(67);
    expect(concurrentShare(0, 10)).toBe(0);
    expect(concurrentShare(5, 0)).toBeNull();
    expect(concurrentShare(0, 0)).toBeNull();
  });
});

describe("gradeSplit — 학년별 재원생", () => {
  const students = [
    { id: "a", grade: "중2" },
    { id: "b", grade: "중1" },
    { id: "c", grade: "중1" },
    { id: "d", grade: null },
    { id: "e", grade: "7세" },
    { id: "f", grade: " 중1 " },
    { id: "g", grade: "중2" },
  ];
  const map = programs([
    ["a", ["eie", "math"]],
    ["b", ["injaewon"]],
    ["c", ["math"]],
    ["d", ["eie"]],
    ["e", ["math"]],
    ["f", ["eie", "injaewon", "math"]],
    // g = 영어·수학 모두 없음
  ]);
  const split = gradeSplit(students, map, ["중1", "중2", "중3"]);

  it("학원설정 학년 순서 + 마지막 줄 '기타·미입력'(설정에 없는 학년·빈 학년)", () => {
    expect(split.rows.map((r) => r.label)).toEqual(["중1", "중2", "중3", OTHER_GRADE_LABEL]);
    expect(split.rows[0]).toEqual({ label: "중1", englishOnly: 1, both: 1, mathOnly: 1 });
    expect(split.rows[1]).toEqual({ label: "중2", englishOnly: 0, both: 1, mathOnly: 0 });
    expect(split.rows[2]).toEqual({ label: "중3", englishOnly: 0, both: 0, mathOnly: 0 });
    expect(split.rows[3]).toEqual({ label: OTHER_GRADE_LABEL, englishOnly: 1, both: 0, mathOnly: 1 });
  });

  it("영어·수학 모두 없는 학생은 막대 밖 각주(neither) — 세 조각 + 각주 = 재원생 명단 수", () => {
    expect(split.neither).toBe(1);
    const inBars = split.rows.reduce((sum, r) => sum + r.englishOnly + r.both + r.mathOnly, 0);
    expect(inBars + split.neither).toBe(students.length);
  });

  it("🔑 보라(영어+수학) 합계 = summarizePrograms.both = 동시 수강", () => {
    const purple = split.rows.reduce((sum, r) => sum + r.both, 0);
    const summary = summarizePrograms(
      students.map((s) => s.id),
      map,
      new Set(students.map((s) => s.id)),
    );
    expect(purple).toBe(summary.both);
    expect(purple).toBe(2);
  });
});

/**
 * '실시간 재원생'(원장 2026-09-16) — 대시보드 '수학 195'와 시간표 '194'가 갈렸던 원인.
 * 실측 우지윤(달성초 6): 활성 수강 2건이 10/1·10/6 시작이라 아직 교실에 앉지 않는데 재원생으로 세어졌다.
 */
describe("notYetStartedStudentIds — 아직 하나도 시작 안 한 학생", () => {
  const TODAY = "2026-09-16";
  const at = (studentId: string, start: string): ActiveEnrollmentRow => ({
    id: `x-${studentId}-${start}`,
    student_id: studentId,
    start_date: start,
    class: { subject: "math", english_track: null },
  });

  it("전부 미래 시작이면 잡는다(우지윤 실측 — 10/1 · 10/6)", () => {
    expect([...notYetStartedStudentIds([at("u", "2026-10-01"), at("u", "2026-10-06")], TODAY)]).toEqual([
      "u",
    ]);
  });

  it("하나라도 시작했으면 안 잡는다 — 10월 수강이 함께 있어도 지금 다니는 중이다", () => {
    // 실측 윤정인·이후성·정채민·허다빈이 이 모양(10월 시작 수강 + 이미 다니는 수학).
    expect(notYetStartedStudentIds([at("y", "2026-03-02"), at("y", "2026-10-03")], TODAY).size).toBe(0);
  });

  it("오늘 시작은 '다니는 중'(경계 포함)", () => {
    expect(notYetStartedStudentIds([at("t", TODAY)], TODAY).size).toBe(0);
  });

  it("🔴 start_date를 모르면 시작한 것으로 본다 — 모름을 미시작으로 읽으면 재원생이 사라진다", () => {
    const unknown: ActiveEnrollmentRow = {
      id: "n1",
      student_id: "n",
      class: { subject: "math", english_track: null },
    };
    expect(notYetStartedStudentIds([unknown], TODAY).size).toBe(0);
  });

  it("수강이 아예 없는 학생은 대상이 아니다 — 행이 없으면 집합에도 없다(반 배정 전 신입은 재원 유지)", () => {
    expect(notYetStartedStudentIds([], TODAY).size).toBe(0);
  });
});

describe("today를 주면 과목 집계·명단이 함께 '실시간'이 된다", () => {
  const TODAY = "2026-09-16";
  const row = (studentId: string, subject: string, start: string): ActiveEnrollmentRow => ({
    id: `r-${studentId}-${subject}-${start}`,
    student_id: studentId,
    start_date: start,
    class: { subject, english_track: null },
  });
  const rows = [
    row("now", "math", "2026-03-02"),
    row("later", "math", "2026-10-01"), // 아직 안 다닌다
  ];
  const students = [
    { id: "now", grade: "중1", school: null },
    { id: "later", grade: "초6", school: null },
    { id: "noclass", grade: "초5", school: null }, // 반 배정 전 — 남는다
  ];

  it("today 없으면 종전 그대로(시작일 무시) — 옛 호출부의 숫자가 조용히 바뀌지 않는다", () => {
    expect(enrolledSubjectCounts(rows, null).bySubject.math).toBe(2);
    expect(composeEnrolled({ students, rows, scope: null, subjects: SUBJECTS }).students).toHaveLength(3);
  });

  it("today를 주면 과목은 시작한 수강만 센다(수학 2 → 1)", () => {
    expect(enrolledSubjectCounts(rows, null, TODAY).bySubject.math).toBe(1);
  });

  it("명단에서는 **미래 시작만 가진 학생만** 빠진다(반 배정 전 학생은 남는다 — 339→338의 근거)", () => {
    const out = composeEnrolled({ students, rows, scope: null, subjects: SUBJECTS, today: TODAY });
    expect(out.students.map((s) => s.id)).toEqual(["now", "noclass"]);
    expect(out.programs.has("later")).toBe(false);
    expect(out.active.has("later")).toBe(false);
  });
});
