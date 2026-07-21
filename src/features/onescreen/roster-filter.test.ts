import { describe, expect, it } from "vitest";
import { rosterIncludesEnrollment } from "./roster-filter";

const base = {
  start_date: "2026-01-01",
  end_date: null as string | null,
  on_hold: false as boolean | null,
  is_transferred: false as boolean | null,
  attendance_days: [] as string[] | null,
};
const DATE = "2026-07-23"; // 목요일

describe("rosterIncludesEnrollment — 원스크린 로스터 노출 판정", () => {
  it("분리등원 없는(빈 배열) 수강은 어느 요일이든 뜬다", () => {
    expect(rosterIncludesEnrollment(base, DATE, "thu", true)).toBe(true);
    expect(rosterIncludesEnrollment({ ...base, attendance_days: null }, DATE, "thu", true)).toBe(true);
  });

  it("월/목 반에 '월요일만' 등원 학생은 목요일에 안 뜬다(원장 제보 케이스)", () => {
    const monOnly = { ...base, attendance_days: ["mon"] };
    expect(rosterIncludesEnrollment(monOnly, DATE, "thu", true)).toBe(false);
    expect(rosterIncludesEnrollment(monOnly, "2026-07-20", "mon", true)).toBe(true);
  });

  it("요일 폴백(그 요일 수업 없음 = 담당 반 전체)에선 요일 조건을 안 건다", () => {
    // 주말엔 dayKey가 sat/sun이라 요일을 걸면 분리등원 학생이 통째로 사라진다.
    const monOnly = { ...base, attendance_days: ["mon"] };
    expect(rosterIncludesEnrollment(monOnly, "2026-07-25", "sat", false)).toBe(true);
  });

  it("휴원(on_hold)은 등원 요일이어도 안 뜬다", () => {
    expect(rosterIncludesEnrollment({ ...base, on_hold: true }, DATE, "thu", true)).toBe(false);
  });

  it("종료 규약은 eligibility 그대로 — 일반 종료는 종료일 포함, 반이동은 그날 제외", () => {
    expect(rosterIncludesEnrollment({ ...base, end_date: DATE }, DATE, "thu", true)).toBe(true);
    expect(
      rosterIncludesEnrollment({ ...base, end_date: DATE, is_transferred: true }, DATE, "thu", true),
    ).toBe(false);
    expect(rosterIncludesEnrollment({ ...base, end_date: "2026-07-22" }, DATE, "thu", true)).toBe(false);
  });

  it("시작 전 수강은 안 뜨고, start_date 없는 레거시 행은 통과시킨다", () => {
    expect(rosterIncludesEnrollment({ ...base, start_date: "2026-07-24" }, DATE, "thu", true)).toBe(false);
    expect(rosterIncludesEnrollment({ ...base, start_date: null }, DATE, "thu", true)).toBe(true);
  });
});
