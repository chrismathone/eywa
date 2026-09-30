import { describe, expect, it } from "vitest";
import { applyAppliedAttendance } from "./apply-applied-attendance";
import { mergedUnits, planMakeupMerge } from "./makeup-merge-plan";
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
    // 조퇴는 조퇴(원장 2026-09-30) — 예전엔 빨간 '결석'으로 접었다.
    expect(
      applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "early_leave", NONE)[0]!
        .attendance,
    ).toBe("조퇴");
  });

  it("🔴 배지는 방금 쓴 칸이 아니라 **행 전체의 우선순위**다 — 다른 반 결석·조퇴를 '출석' 방송이 가리지 않는다", () => {
    const absentElsewhere = [
      stu("s1", [row({ classId: "c1" }), row({ classId: "c2", name: "영어", attendanceRaw: "absent" })], {
        attendance: "결석",
      }),
    ];
    expect(
      applyAppliedAttendance(absentElsewhere, [{ studentId: "s1", classId: "c1" }], "present", NONE)[0]!.attendance,
    ).toBe("결석");
    const leftEarly = [
      stu("s1", [row({ classId: "c1" }), row({ classId: "c2", name: "영어", attendanceRaw: "early_leave" })], {
        attendance: "조퇴",
      }),
    ];
    expect(
      applyAppliedAttendance(leftEarly, [{ studentId: "s1", classId: "c1" }], "late", NONE)[0]!.attendance,
    ).toBe("조퇴");
  });

  it("🔴 행에 못 붙은 내 반 칸(attendanceOffRow)의 정정도 반영한다 — 결석→출석이면 배지가 즉시 출석", () => {
    const before = [stu("s1", [row({ classId: "c1" })], { attendance: "결석", attendanceOffRow: { mk: "absent" } })];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "mk" }], "present", NONE)[0]!;
    expect(after.attendanceOffRow).toEqual({ mk: "present" });
    expect(after.attendance).toBe("출석");
    // 키가 없는 반(내 반인지 모른다)은 새로 만들지 않는다 — 참조 그대로.
    expect(applyAppliedAttendance(before, [{ studentId: "s1", classId: "zz" }], "absent", NONE)).toBe(before);
  });

  it("units 키가 없는 칸(갱신 — 기존 시수 보존)은 메모·시수를 건드리지 않는다", () => {
    const before = [stu("s1", [row({ attendanceNote: "병원", attendanceUnits: 2 })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1" }], "present", NONE);
    expect(after[0]!.subjects[0]!.attendanceNote).toBe("병원");
    expect(after[0]!.subjects[0]!.attendanceUnits).toBe(2);
  });

  it("🔴 새로 만든 칸은 서버가 실제로 넣은 시수(수학 자동 시수 1.5)로 맞춘다 — 1로 남기면 안 된다", () => {
    const before = [stu("s1", [row({ attendanceAutoUnits: 1.5 })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1", units: 1.5 }], "present", NONE);
    expect(after[0]!.subjects[0]!.attendanceRaw).toBe("present");
    expect(after[0]!.subjects[0]!.attendanceUnits).toBe(1.5);
  });

  it("units: null도 사실이다(비수학·조회 실패 = 1) — 상태가 같아도 시수가 다르면 맞춘다", () => {
    // 낡은 화면(다른 곳에서 지운 칸이 '출석·2'로 남아 있음)에 서버가 새 행(null)을 만든 경우.
    const before = [stu("s1", [row({ attendanceRaw: "present", attendanceUnits: 2 })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1", units: null }], "present", NONE);
    expect(after).not.toBe(before);
    expect(after[0]!.subjects[0]!.attendanceUnits).toBeNull();
    // 상태·시수가 이미 같으면 참조 그대로(리렌더 0).
    const same = [stu("s1", [row({ attendanceRaw: "present", attendanceUnits: 1.5 })])];
    expect(applyAppliedAttendance(same, [{ studentId: "s1", classId: "c1", units: 1.5 }], "present", NONE)).toBe(same);
  });

  it("🔴 방송 뒤 보강 합침이 **1.5 기록 위에** 더한다 — 1 + 보강으로 덮어 0.5가 사라지지 않게", () => {
    // 수학 165분 반, 빈 행 → 스트립 '전원 출석'이 새 행에 1.5를 넣고 방송했다.
    const before = [stu("s1", [row({ subjectKey: "math", attendanceAutoUnits: 1.5 })])];
    const after = applyAppliedAttendance(before, [{ studentId: "s1", classId: "c1", units: 1.5 }], "present", NONE);
    const plan = planMakeupMerge(after[0]!.subjects, new Set(["math"]));
    expect(plan.kind).toBe("ask");
    const cand = plan.kind === "ask" ? plan.candidates[0]! : null;
    expect(cand?.attendanceUnits).toBe(1.5);
    expect(mergedUnits(cand?.attendanceUnits)).toBe(2.5); // 정규 1.5 + 보강 1
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
