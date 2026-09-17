import { describe, expect, it } from "vitest";
import { formatTermDays, individualAttendDays } from "./term-days";

describe("회차 확정 요일 표시 (원장 2026-09-17)", () => {
  it("요일은 월요일부터 · 가운뎃점으로 잇는다", () => {
    expect(formatTermDays([4, 1])).toBe("월·목");
    expect(formatTermDays([0, 6])).toBe("토·일");
    expect(formatTermDays([])).toBe("");
    expect(formatTermDays(null)).toBe("");
  });

  it("개별 등원 요일은 반 요일과 다를 때만 — 비어 있으면(반 요일 전부) 없다", () => {
    expect(individualAttendDays([1, 4], [{ attendanceDays: ["thu"] }])).toEqual([4]);
    expect(individualAttendDays([1, 4], [{ attendanceDays: ["thu", "mon"] }])).toBeNull();
    expect(individualAttendDays([1, 4], [{ attendanceDays: [] }])).toBeNull();
    expect(individualAttendDays([1, 4], [{ attendanceDays: null }])).toBeNull();
    expect(individualAttendDays([1, 4], [])).toBeNull();
  });

  it("반 요일과 교집합으로 본다 — 반이 옮겨 가 없는 요일은 안 보이고, 그 달 배치가 없으면 표시하지 않는다", () => {
    // 월·수·금 → 월·금으로 바뀐 반에 [월,수,금]이 남은 학생 = 반 요일에 다 온다.
    expect(individualAttendDays([1, 5], [{ attendanceDays: ["mon", "wed", "fri"] }])).toBeNull();
    // 화·목으로 옮긴 반에 [월]이 남음 = 교집합 없음 → 표시 없음(예정 0은 '확정 ≠ 예정'이 따로 말한다).
    expect(individualAttendDays([2, 4], [{ attendanceDays: ["mon"] }])).toBeNull();
    expect(individualAttendDays([1, 3, 5], [{ attendanceDays: ["mon", "tue"] }])).toEqual([1]);
    expect(individualAttendDays([], [{ attendanceDays: ["thu"] }])).toBeNull();
  });

  it("한 달에 수강이 둘이면(반이동 등) 합친다 — 하나라도 전체 등원이면 개별 없음", () => {
    expect(individualAttendDays([1, 3, 5], [{ attendanceDays: ["mon"] }, { attendanceDays: ["fri"] }])).toEqual([1, 5]);
    expect(individualAttendDays([1, 3, 5], [{ attendanceDays: ["mon"] }, { attendanceDays: [] }])).toBeNull();
  });
});
