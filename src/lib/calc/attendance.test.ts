import { describe, it, expect } from "vitest";
import { attendanceRate } from "./attendance";

describe("attendanceRate", () => {
  it("정상 비율", () => expect(attendanceRate(8, 10)).toBe(80));
  it("전원 출석 → 100", () => expect(attendanceRate(5, 5)).toBe(100));
  it("0건 → 0 (0-나눗셈 방어)", () => expect(attendanceRate(0, 0)).toBe(0));
  it("음수 total 방어", () => expect(attendanceRate(3, -1)).toBe(0));
  it("소수 결과 유지", () => expect(attendanceRate(1, 3)).toBeCloseTo(33.333, 2));
});
