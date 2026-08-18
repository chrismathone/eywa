import { describe, expect, it } from "vitest";
import { planQuickPresent } from "./quick-attendance";
import type { OneScreenStudent, Subject } from "./types";

const row = (over: Partial<Subject> = {}): Subject =>
  ({
    name: "수학",
    prev: "",
    today: "",
    classId: "c1",
    className: "중3 수학",
    attendanceRaw: null,
    ...over,
  }) as Subject;

const stu = (id: string, subjects: Subject[], over: Partial<OneScreenStudent> = {}): OneScreenStudent =>
  ({ id, name: id, subjects, ...over }) as OneScreenStudent;

describe("planQuickPresent — 빈 칸만 채우는 비파괴 계획", () => {
  it("기록 없는 칸만 대상 — 이미 찍힌 칸은 손대지 않는다", () => {
    const plan = planQuickPresent(
      [
        stu("s1", [row()]),
        stu("s2", [row({ attendanceRaw: "absent" })]),
        stu("s3", [row({ attendanceRaw: "present" })]),
        stu("s4", [row({ attendanceRaw: "late" })]),
        stu("s5", [row()]),
      ],
      null,
    );
    expect(plan.cells.map((c) => c.studentId)).toEqual(["s1", "s5"]);
    expect(plan.alreadyMarked).toBe(3);
  });

  it("🔴 조퇴·공결·보강(축약 3종 밖)은 대상이 아니다 — 되쓰면 출석부 기록이 뭉개진다", () => {
    const plan = planQuickPresent(
      [stu("s1", [row({ attendanceRaw: "early_leave" })]), stu("s2", [row({ attendanceRaw: "excused" })])],
      null,
    );
    expect(plan.cells).toEqual([]);
    expect(plan.alreadyMarked).toBe(2);
  });

  it("반이 없는 행(모호·수동 추가 보강)은 기록할 자리가 없어 제외 — '이미 찍힘'으로도 안 센다", () => {
    const plan = planQuickPresent(
      [
        stu("s1", [row({ classId: null })]),
        stu("s2", [row()], { isMakeup: true }),
      ],
      null,
    );
    expect(plan.cells).toEqual([]);
    expect(plan.alreadyMarked).toBe(0);
  });

  it("한 학생이 두 반이면 두 칸 — 찍힌 반은 빼고 빈 반만", () => {
    const plan = planQuickPresent(
      [
        stu("s1", [
          row({ name: "수학", classId: "c1" }),
          row({ name: "수학 특강", classId: "c2", className: "고1 특강", attendanceRaw: "present" }),
          row({ name: "영어", classId: "c3", className: "중3 영어" }),
        ]),
      ],
      null,
    );
    expect(plan.cells).toEqual([
      { studentId: "s1", classId: "c1" },
      { studentId: "s1", classId: "c3" },
    ]);
    expect(plan.alreadyMarked).toBe(1);
  });

  it("🔴 반 필터를 켜면 그 반 행만 — 화면에 없는 반이 함께 출석 처리되면 안 된다", () => {
    const students = [
      stu("s1", [
        row({ name: "수학", classId: "c1", className: "중3 수학" }),
        row({ name: "영어", classId: "c3", className: "중3 영어" }),
      ]),
    ];
    expect(planQuickPresent(students, "중3 수학").cells).toEqual([{ studentId: "s1", classId: "c1" }]);
    expect(planQuickPresent(students, null).cells).toHaveLength(2);
  });

  it("같은 (학생·반)이 두 행으로 와도 한 칸 — 출결 원장은 그 조합에 한 칸이다", () => {
    const plan = planQuickPresent(
      [stu("s1", [row({ name: "수학" }), row({ name: "수학 보강" })])],
      null,
    );
    expect(plan.cells).toEqual([{ studentId: "s1", classId: "c1" }]);
  });

  it("전원 기록된 목록은 대상 0 — 화면이 버튼을 비활성으로 만들 수 있게 이유(alreadyMarked)를 함께 준다", () => {
    const plan = planQuickPresent([stu("s1", [row({ attendanceRaw: "present" })])], null);
    expect(plan.cells).toEqual([]);
    expect(plan.alreadyMarked).toBe(1);
  });

  it("빈 목록도 안전하게 0건", () => {
    expect(planQuickPresent([], null)).toEqual({ cells: [], alreadyMarked: 0 });
  });
});
