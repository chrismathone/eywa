import { describe, expect, it } from "vitest";
import { applyAppliedAttendance } from "./apply-applied-attendance";
import type { OneScreenStudent, Subject } from "./types";

const row = (over: Partial<Subject> = {}): Subject =>
  ({
    name: "수학",
    prev: "",
    today: "",
    classId: "c1",
    className: "중3 수학",
    attendanceRaw: null,
    attendanceNote: null,
    attendanceUnits: null,
    ...over,
  }) as Subject;

const stu = (id: string, subjects: Subject[], over: Partial<OneScreenStudent> = {}): OneScreenStudent =>
  ({ id, name: id, attendance: "출석", subjects, ...over }) as OneScreenStudent;

const NONE: ReadonlySet<string> = new Set<string>();

describe("applyAppliedAttendance — 스트립이 기록한 칸만 화면에 반영", () => {
  it("빈 칸이 status로 채워진다", () => {
    const before = [stu("s1", [row()]), stu("s2", [row()])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE);
    expect(after[0]!.subjects[0]!.attendanceRaw).toBe("present");
    // 안 실린 학생은 **같은 객체 참조** — 그 카드는 다시 그리지 않는다.
    expect(after[1]).toBe(before[1]);
  });

  it("🔴 in-flight(pending) 칸은 건너뛴다 — 내가 방금 누른 알약이 이긴다", () => {
    const before = [stu("s1", [row({ attendanceRaw: "absent" })])];
    const after = applyAppliedAttendance(
      before,
      [{ studentId: "s1", classId: "c1" }],
      "present",
      new Set(["s1::c1"]),
    );
    expect(after).toBe(before); // 아무것도 안 바뀌었으니 참조까지 그대로
    expect(after[0]!.subjects[0]!.attendanceRaw).toBe("absent");
  });

  it("로스터에 없는 학생·반은 무시한다", () => {
    const before = [stu("s1", [row({ classId: "c1" })])];
    const after = applyAppliedAttendance(
      before,
      [
        { studentId: "없는학생", classId: "c1" },
        { studentId: "s1", classId: "다른반" },
      ],
      "present",
      NONE,
    );
    expect(after).toBe(before);
  });

  it("이미 그 상태면 변화 없음 = 같은 참조(리렌더 0)", () => {
    const before = [stu("s1", [row({ attendanceRaw: "present" })])];
    expect(applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE)).toBe(
      before,
    );
    expect(applyAppliedAttendance(before, [], "present", NONE)).toBe(before);
  });

  it("학생 배지(attendance)도 같은 표로 함께 갱신된다", () => {
    const before = [stu("s1", [row()], { attendance: "출석" })];
    expect(
      applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "absent", NONE)[0]!
        .attendance,
    ).toBe("결석");
    expect(
      applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "late", NONE)[0]!
        .attendance,
    ).toBe("지각");
    expect(
      applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "early_leave", NONE)[0]!
        .attendance,
    ).toBe("결석");
  });

  it("메모·시수는 건드리지 않는다 — 스트립은 그 둘을 보내지 않는다", () => {
    const before = [stu("s1", [row({ attendanceNote: "병원", attendanceUnits: 2 })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE);
    expect(after[0]!.subjects[0]!.attendanceNote).toBe("병원");
    expect(after[0]!.subjects[0]!.attendanceUnits).toBe(2);
  });

  it("같은 학생의 **다른 반 행**은 그대로 — 반 단위로만 반영한다", () => {
    const before = [stu("s1", [row({ classId: "c1" }), row({ classId: "c2", name: "영어" })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE);
    expect(after[0]!.subjects[0]!.attendanceRaw).toBe("present");
    expect(after[0]!.subjects[1]!.attendanceRaw).toBeNull();
    // 안 바뀐 행은 객체 참조까지 유지(입력 칸 리렌더 방지)
    expect(after[0]!.subjects[1]).toBe(before[0]!.subjects[1]);
  });

  it("반이 모호한 행(classId 없음)은 대상이 아니다", () => {
    const before = [stu("s1", [row({ classId: null })])];
    expect(applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE)).toBe(
      before,
    );
  });
});
