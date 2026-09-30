import { describe, expect, it } from "vitest";
import {
  attendanceMarkBadgeClass,
  attendanceMarkLabel,
  attendanceMarkOf,
  MARK_ABSENT,
  MARK_EARLY_LEAVE,
  MARK_LATE,
  MARK_PRESENT,
  studentMarkFromRows,
  studentMarkOf,
} from "./attendance-mark";
import type { Subject } from "./types";

const rows = (raws: (string | null)[], offRow?: Record<string, string>) => ({
  subjects: raws.map((r, i) => ({ classId: `c${i}`, attendanceRaw: r }) as Subject),
  attendanceOffRow: offRow,
});

describe("attendanceMarkOf — 칸 하나의 배지", () => {
  it("🔴 조퇴는 조퇴다(원장 2026-09-30) — 빨간 '결석'으로 접지 않는다", () => {
    expect(attendanceMarkOf("early_leave")).toBe(MARK_EARLY_LEAVE);
    expect(attendanceMarkOf("early_leave")).not.toBe(MARK_ABSENT);
  });

  it("그 밖은 종전 그대로 — 무기록·공결·보강은 '출석'", () => {
    expect(attendanceMarkOf("late")).toBe(MARK_LATE);
    expect(attendanceMarkOf("absent")).toBe(MARK_ABSENT);
    expect(attendanceMarkOf("present")).toBe(MARK_PRESENT);
    expect(attendanceMarkOf(null)).toBe(MARK_PRESENT);
    expect(attendanceMarkOf(undefined)).toBe(MARK_PRESENT);
    expect(attendanceMarkOf("excused")).toBe(MARK_PRESENT);
    expect(attendanceMarkOf("makeup")).toBe(MARK_PRESENT);
  });
});

describe("studentMarkOf — 학생 한 명의 여러 칸 모으기(결석 > 조퇴 > 지각 > 출석)", () => {
  it("영어 출석 + 수학 조퇴 = 조퇴", () => {
    expect(studentMarkOf(["present", "early_leave"])).toBe(MARK_EARLY_LEAVE);
  });
  it("조퇴가 지각보다 위 — 지금 학원에 없다", () => {
    expect(studentMarkOf(["late", "early_leave"])).toBe(MARK_EARLY_LEAVE);
    expect(studentMarkOf(["early_leave", "late"])).toBe(MARK_EARLY_LEAVE);
  });
  it("결석이 가장 위 — 순서와 무관(마지막에 찍은 칸이 앞의 결석을 가리지 않는다)", () => {
    expect(studentMarkOf(["absent", "present"])).toBe(MARK_ABSENT);
    expect(studentMarkOf(["early_leave", "absent", "late"])).toBe(MARK_ABSENT);
  });
  it("기록 없는 칸은 셈에 안 넣는다 — 아무것도 없으면 출석", () => {
    expect(studentMarkOf([])).toBe(MARK_PRESENT);
    expect(studentMarkOf([null, undefined, "late"])).toBe(MARK_LATE);
  });
});

describe("studentMarkFromRows — 로스터·클라 공용", () => {
  it("반이 있는 행 raw + 행에 못 붙은 내 반 칸(attendanceOffRow)을 함께 본다", () => {
    expect(studentMarkFromRows(rows(["present"], { x9: "early_leave" }))).toBe(MARK_EARLY_LEAVE);
    expect(studentMarkFromRows(rows(["present"]))).toBe(MARK_PRESENT);
  });
  it("반 없는 행(보강·반 모호)의 raw는 재료가 아니다 — 기록할 자리가 없는 행", () => {
    const s = { subjects: [{ classId: null, attendanceRaw: "absent" } as unknown as Subject] };
    expect(studentMarkFromRows(s)).toBe(MARK_PRESENT);
  });
});

describe("배지 글자·색", () => {
  it("영어 강사뷰 — 앱 전역 라벨(Left early), 한국어 기본", () => {
    expect(attendanceMarkLabel(MARK_EARLY_LEAVE)).toBe("조퇴");
    expect(attendanceMarkLabel(MARK_EARLY_LEAVE, "en")).toBe("Left early");
  });
  it("의미색 캐논 — 조퇴 = info(파랑), 결석 빨강과 다르다", () => {
    expect(attendanceMarkBadgeClass(MARK_EARLY_LEAVE)).toContain("blue");
    expect(attendanceMarkBadgeClass(MARK_EARLY_LEAVE, { strongAbsent: true })).toContain("blue");
    expect(attendanceMarkBadgeClass(MARK_LATE)).toContain("amber");
    expect(attendanceMarkBadgeClass(MARK_ABSENT)).toContain("danger");
    expect(attendanceMarkBadgeClass(MARK_ABSENT, { strongAbsent: true })).toBe("bg-danger text-white");
  });
});
