import { describe, expect, it } from "vitest";
import { actualLessonSalary, attendanceSalaryRate, parseAttendanceRates, type AttendanceSalaryRates } from "./salary-rates";
const cls = "aaaaaaaa-1111-1111-1111-111111111111";
const rates: AttendanceSalaryRates = { regular: { 초등: 40, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 60, 고등: 65 }, classes: {} };

describe("regular/special × student grade rates", () => {
  it.each([["초5", 40, 55], ["중2", 45, 60], ["고3", 50, 65]] as const)("uses %s student's grade even in a mixed high-school-named class", (grade, regular, special) => {
    const row = { classId: cls, className: "고등M 개별", grade };
    expect(attendanceSalaryRate(rates, row)).toBe(regular);
    expect(attendanceSalaryRate(rates, { ...row, isSpecial: true })).toBe(special);
    expect(attendanceSalaryRate(rates, { ...row, className: "[특강] 개별" })).toBe(special);
  });
  it("respects a teacher-specific class override, including 0%, and never assumes a missing grade", () => {
    const row = { classId: cls, className: "LS4", grade: null };
    expect(attendanceSalaryRate(rates, row)).toBeNull();
    expect(attendanceSalaryRate({ ...rates, classes: { [cls]: 0 } }, row)).toBe(0);
    expect(attendanceSalaryRate({ ...rates, classes: { [cls]: 47.5 } }, row)).toBe(47.5);
  });
  it("calculates the stated salary formula, keeping established row precision", () => {
    const price = [{ unitPrice: 27250, monthly: false, daysBasis: false }];
    expect(actualLessonSalary(price, 12, 45)).toBe(134053.6);
    expect(actualLessonSalary(price, 12, 0)).toBe(0);
    expect(actualLessonSalary(price, 12, null)).toBeNull();
    expect(actualLessonSalary([{ ...price[0]!, monthly: true }], 12, 45)).toBeNull();
  });
  it("rejects invalid values and retains six independently configured cells", () => {
    expect(parseAttendanceRates(rates)).toEqual(rates);
    for (const rate of [-1, 101, NaN, Infinity, "45", null]) {
      expect(parseAttendanceRates({ ...rates, regular: { 초등: rate } })).toBeNull();
    }
    expect(parseAttendanceRates({ ...rates, special: { 기타: 40 } })).toBeNull();
  });
});
