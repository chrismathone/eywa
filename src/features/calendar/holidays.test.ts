import { describe, it, expect } from "vitest";
import { HOLIDAY_YEARS, holidayFor, holidayShortName, isHoliday } from "./holidays";

describe("대한민국 법정공휴일 테이블", () => {
  it("설날·추석 — 연휴 사흘이 전부 공휴일", () => {
    expect(holidayFor("2026-02-16")).toBe("설날 연휴");
    expect(holidayFor("2026-02-17")).toBe("설날");
    expect(holidayFor("2026-02-18")).toBe("설날 연휴");
    expect(holidayFor("2026-09-25")).toBe("추석");
    expect(holidayFor("2027-02-07")).toBe("설날");
    expect(holidayFor("2027-09-15")).toBe("추석");
  });

  it("대체공휴일 — 겹친 명절·국경일의 다음 평일", () => {
    expect(holidayFor("2026-03-02")).toBe("대체공휴일(삼일절)");
    expect(holidayFor("2026-08-17")).toBe("대체공휴일(광복절)");
    expect(holidayFor("2027-02-09")).toBe("대체공휴일(설날)");
    expect(holidayFor("2027-12-27")).toBe("대체공휴일(성탄절)");
  });

  it("2026 전국동시지방선거일도 법정 공휴일", () => {
    expect(holidayFor("2026-06-03")).toBe("지방선거일");
  });

  it("평일·근로자의 날(비법정)은 null", () => {
    expect(holidayFor("2026-08-18")).toBeNull();
    expect(holidayFor("2026-05-01")).toBeNull(); // 근로자의 날 — 법정공휴일 아님(머리 주석)
    expect(isHoliday("2026-07-15")).toBe(false);
  });

  it("내장 범위 밖 연도는 null — 지어내지 않는다", () => {
    expect(holidayFor("2025-01-01")).toBeNull();
    expect(holidayFor("2028-01-01")).toBeNull();
    expect(HOLIDAY_YEARS).toEqual([2026, 2027]);
  });

  it("짧은 이름 — 대체공휴일은 괄호를 뗀다", () => {
    expect(holidayShortName("2026-08-17")).toBe("대체공휴일");
    expect(holidayShortName("2026-08-15")).toBe("광복절");
    expect(holidayShortName("2026-08-18")).toBeNull();
  });
});
