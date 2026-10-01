import { describe, expect, it } from "vitest";
import {
  buildRosterReview,
  compareRosterMembers,
  needsRosterConfirmation,
} from "./roster-review";
import {
  matchRosterStudent,
  type RosterStudentRef,
} from "../roster/match-roster";
import type { MasterContext, MasterInput } from "./types";

const student = (
  studentId: string,
  name: string,
  school = "침산초",
  grade = "초2",
): RosterStudentRef => ({ studentId, name, school, grade, status: "enrolled" });
describe("학생 동일성 확인", () => {
  it.each(["김하윤C", "김윤아B", "박서준 C"])(
    "%s의 이름이 유일하게 일치하면 형제 이름 후보가 있어도 재확인하지 않는다",
    (name) => {
      const exact = student("s1", name.replaceAll(" ", ""));
      const students = [
        exact,
        student("s2", name.replace(/[ABC]$/, "A"), "칠성초", "초3"),
      ];
      const match = matchRosterStudent(name, "침산초", "초2", students);
      expect(match).toMatchObject({
        status: "ok",
        studentId: "s1",
        basis: "school+grade",
      });
      expect(needsRosterConfirmation(name, match, students)).toBe(false);
    },
  );
  it("학교로 연결한 접미사 다른 학생은 확인하며 이름만 같은 퇴원 학생으로 바꾸지 않는다", () => {
    const students = [
      { ...student("old", "이도윤", "침산중", "중1"), status: "withdrawn" },
      student("s1", "이도윤B", "칠성초", "초3"),
    ];
    const match = matchRosterStudent("이도윤", "칠성초", "초3", students);
    expect(match).toMatchObject({ status: "ok", studentId: "s1" });
    expect(needsRosterConfirmation("이도윤", match, students)).toBe(true);
  });
  it("동일한 전체 이름의 학생 기록이 둘이면 학교로 좁혀도 확인한다", () => {
    const students = [
      student("s1", "김하윤C"),
      student("s2", "김하윤C", "칠성초"),
    ];
    const match = matchRosterStudent("김하윤C", "침산초", "초2", students);
    expect(needsRosterConfirmation("김하윤C", match, students)).toBe(true);
  });
  it("매칭 불명확은 확인 체크로 통과시키지 않는다", () => {
    expect(
      needsRosterConfirmation(
        "김하윤",
        { status: "ambiguous", candidates: [] },
        [],
      ),
    ).toBe(false);
  });
});

describe("반 명단 비교", () => {
  it("동명이인은 학생 ID로 구분하고 미연결 행도 남긴다", () => {
    const sheet = [
      {
        name: "김하윤",
        school: null,
        grade: null,
        raw: "김하윤",
        student: student("s1", "김하윤"),
        candidates: [],
        needsConfirmation: false,
      },
      {
        name: "미확정",
        school: null,
        grade: null,
        raw: "미확정",
        student: null,
        candidates: [],
        needsConfirmation: false,
      },
    ];
    const result = compareRosterMembers(sheet, [
      { ...student("s2", "김하윤"), onHold: false },
    ]);
    expect(result.common.size).toBe(0);
    expect([...result.sheetOnly]).toEqual(["s1"]);
    expect(result.existingOnly.map((s) => s.studentId)).toEqual(["s2"]);
    expect(result.unresolved).toBe(1);
  });
  it("이동 종료 경계·미래 수강을 제외하고 휴원과 일반 종료일을 보존한다", () => {
    const students = [
      student("held", "휴원"),
      student("moved", "이동"),
      student("ended", "일반종료"),
      student("future", "미래"),
    ];
    const enrollment = (id: string) => ({
      id,
      studentId: id,
      classId: "c1",
      startDate: "2026-09-01",
      endDate: null,
      onHold: false,
      isTransferred: false,
      attendanceDays: null,
    });
    const ctx: MasterContext = {
      classes: [
        {
          id: "c1",
          className: "PL1",
          subject: "english",
          active: true,
          closedAt: null,
          track: "eie",
          teacherId: null,
          classroomId: null,
        },
      ],
      students,
      enrollments: [
        { ...enrollment("held"), onHold: true },
        { ...enrollment("moved"), isTransferred: true, endDate: "2026-10-01" },
        { ...enrollment("ended"), endDate: "2026-10-01" },
        { ...enrollment("future"), startDate: "2026-10-02" },
      ],
      teachers: [],
      classrooms: [],
      schedules: [],
      groups: [],
      blocks: [],
      attendance: [],
      pending: [],
    };
    const input: MasterInput = {
      source: "sheet",
      effectiveDate: "2026-10-01",
      teacherTab: "t",
      rosterTab: "r",
      maxColumn: "",
      classBindings: {},
    };
    const result = buildRosterReview(
      input,
      { teacher: { cells: [], merges: [] }, roster: { cells: [], merges: [] } },
      ctx,
    );
    expect(result.existing[0]!.members.map((s) => s.studentId).sort()).toEqual([
      "ended",
      "held",
    ]);
    expect(
      result.existing[0]!.members.find((s) => s.studentId === "held")?.onHold,
    ).toBe(true);
  });
});
