import { describe, expect, it } from "vitest";
import { attendanceUnitSuffix, attendanceUnitsDiff, formatUnitsWithSuffix } from "./unit-suffix";

/** 학원설정 과목 표(운영 enum 단일 소스) — 수학(심화)는 `subject_1` 계열이 정본이다. */
const SUBJECTS = [
  { key: "english", label: "영어" },
  { key: "math", label: "수학" },
  { key: "subject_1", label: "수학(심화)" },
  { key: "subject_9", label: "국어" },
];

describe("차수 단위 글자 — 영어 U · 수학 T (원장 2026-09-18)", () => {
  it("영어는 U, 수학은 T", () => {
    expect(attendanceUnitSuffix("english", SUBJECTS)).toBe("U");
    expect(attendanceUnitSuffix("math", SUBJECTS)).toBe("T");
  });

  it("🔴 수학(심화)도 수학이다 — 과목 키를 코드에 적지 않고 학원설정 라벨로 묶는다", () => {
    expect(attendanceUnitSuffix("subject_1", SUBJECTS)).toBe("T");
  });

  it("영어·수학 어느 쪽도 아니면 안 붙인다(모르는 단위를 사실처럼 적지 않는다)", () => {
    expect(attendanceUnitSuffix("subject_9", SUBJECTS)).toBeNull();
    expect(attendanceUnitSuffix(null, SUBJECTS)).toBeNull();
    expect(attendanceUnitSuffix("", SUBJECTS)).toBeNull();
    // 설정에 없는 키 — 라벨을 못 찾으면 묶음도 없다.
    expect(attendanceUnitSuffix("subject_42", SUBJECTS)).toBeNull();
  });

  it("표시 = `숫자 단위`, 정수는 소수점 없이", () => {
    expect(formatUnitsWithSuffix(3, "U")).toBe("3 U");
    expect(formatUnitsWithSuffix(1.5, "U")).toBe("1.5 U");
    expect(formatUnitsWithSuffix(2, "T")).toBe("2 T");
    expect(formatUnitsWithSuffix(4.5, null)).toBe("4.5");
    expect(formatUnitsWithSuffix(-4.5, "T")).toBe("-4.5 T");
  });
});

describe("차이확인 = 수업 차수 − 등록 차수", () => {
  it("뺀 값을 소수 한 자리로 — 부동소수 꼬리를 남기지 않는다", () => {
    expect(attendanceUnitsDiff(7.5, { units: 12 })).toBe(-4.5);
    expect(attendanceUnitsDiff(9, { units: 7 })).toBe(2);
    expect(attendanceUnitsDiff(5, { units: 5 })).toBe(0);
    expect(attendanceUnitsDiff(4.8, { units: 0.1 })).toBe(4.7);
  });

  it("🔴 미확정이면 null — 0으로 치면 '전부 초과'라는 거짓 신호가 열 전체에 깔린다", () => {
    expect(attendanceUnitsDiff(7.5, null)).toBeNull();
    expect(attendanceUnitsDiff(7.5, undefined)).toBeNull();
  });

  it("🔴 옛 '일수 기준' 확정은 단위가 달라(시수가 아니라 출석 일수) 빼지 않는다", () => {
    expect(attendanceUnitsDiff(7.5, { units: 9, daysBasis: true })).toBeNull();
    expect(attendanceUnitsDiff(7.5, { units: 9, daysBasis: false })).toBe(-1.5);
  });
});
