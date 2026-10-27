import { describe, expect, it } from "vitest";
import { buildHomeroomTeachers, recentMonths, type HomeroomInput } from "./homeroom-model";

const base = (over: Partial<HomeroomInput> = {}): HomeroomInput => ({
  today: "2026-10-27",
  months: ["2026-08", "2026-09", "2026-10"],
  classes: [{ id: "c1", name: "중등M 중1", teacherId: "t1" }],
  teacherNames: new Map([["t1", "김담임"]]),
  enrollments: [
    { studentId: "s1", classId: "c1", startDate: "2026-03-02" },
    { studentId: "s2", classId: "c1", startDate: "2026-09-15" },
  ],
  students: new Map([
    ["s1", { name: "가학생", grade: "중1" }],
    ["s2", { name: "나학생", grade: "중1" }],
  ]),
  consults: [],
  ...over,
});

describe("recentMonths", () => {
  it("이번 달 포함 거꾸로 n달 · 해를 넘는다", () => {
    expect(recentMonths("2026-02-10", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildHomeroomTeachers", () => {
  it("담임 본인 상담 = self · 다른 직원만 = other · 없음 = none · 반 들어오기 전 = before(분모 밖)", () => {
    const [t] = buildHomeroomTeachers(
      base({
        consults: [
          { studentId: "s1", counselorId: "t1", date: "2026-08-03" },
          { studentId: "s1", counselorId: "t1", date: "2026-08-20" },
          { studentId: "s1", counselorId: "desk", date: "2026-09-01" },
          { studentId: "s2", counselorId: "t1", date: "2026-10-02" },
        ],
      }),
    );
    const s1 = t!.students.find((s) => s.id === "s1")!;
    const s2 = t!.students.find((s) => s.id === "s2")!;
    expect(s1.cells).toEqual(["self", "other", "none"]);
    expect(s1.selfCounts).toEqual([2, 0, 0]);
    expect(s1.lastSelf).toBe("2026-08-20");
    expect(s2.cells).toEqual(["before", "none", "self"]);
    expect(t!.months).toEqual([
      { target: 1, self: 1, other: 0, none: 0 },
      { target: 2, self: 0, other: 1, none: 1 },
      { target: 2, self: 1, other: 0, none: 1 },
    ]);
  });

  it("이번 달 미상담이 맨 위", () => {
    const [t] = buildHomeroomTeachers(base({ consults: [{ studentId: "s2", counselorId: "t1", date: "2026-10-02" }] }));
    expect(t!.students.map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("재원생 명단에 없는 학생·담임 반이 아닌 수강은 버리고, 학생이 없는 담임은 세우지 않는다", () => {
    const out = buildHomeroomTeachers(
      base({
        classes: [
          { id: "c1", name: "A", teacherId: "t1" },
          { id: "c2", name: "B", teacherId: "t2" },
        ],
        enrollments: [
          { studentId: "s1", classId: "c1", startDate: null },
          { studentId: "gone", classId: "c2", startDate: null },
          { studentId: "s2", classId: "seat", startDate: null },
        ],
      }),
    );
    expect(out.map((t) => t.id)).toEqual(["t1"]);
    expect(out[0]!.students.map((s) => s.id)).toEqual(["s1"]);
    // 시작일 모름 = 처음부터 있던 것으로(before 없음).
    expect(out[0]!.students[0]!.cells).not.toContain("before");
  });

  it("한 담임의 두 반에 있는 학생은 한 줄 · 가장 이른 시작일", () => {
    const [t] = buildHomeroomTeachers(
      base({
        classes: [
          { id: "c1", name: "A", teacherId: "t1" },
          { id: "c2", name: "B", teacherId: "t1" },
        ],
        enrollments: [
          { studentId: "s1", classId: "c1", startDate: "2026-10-01" },
          { studentId: "s1", classId: "c2", startDate: "2026-08-10" },
        ],
      }),
    );
    expect(t!.students).toHaveLength(1);
    expect(t!.students[0]!.cells[0]).toBe("none");
    expect(t!.classNames).toEqual(["A", "B"]);
  });
});
