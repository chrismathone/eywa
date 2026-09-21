import { describe, expect, it } from "vitest";
import { actualLessonSalary, actualSalaryBase, attendanceSalaryRate, parseAttendanceRates, salaryBilledCap, type AttendanceSalaryRates } from "./salary-rates";
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

describe("실급여는 실수업액이 청구액을 넘으면 청구액으로(원장 2026-09-21 — 받은 돈보다 많이 주지 않는다)", () => {
  const price = [{ unitPrice: 24000, monthly: false, daysBasis: false }];
  it("원장 캡처 행: 단가 24,000 · 청구 72,000 · 실수업 4T(96,000) → 청구액 72,000 기준", () => {
    // 종전(실수업액 기준) = floor1(96,000 × 0.911 × 47.5%) = 41,541.6
    expect(actualLessonSalary(price, 4, 47.5)).toBe(41541.6);
    expect(actualLessonSalary(price, 4, 47.5, 72000)).toBe(31156.2);
    expect(actualSalaryBase(price, 4, 72000)).toEqual({ base: 72000, capped: true });
  });
  it("실수업액이 청구액 이하면 종전 그대로", () => {
    expect(actualLessonSalary(price, 3, 47.5, 72000)).toBe(actualLessonSalary(price, 3, 47.5));
    expect(actualLessonSalary(price, 2, 47.5, 72000)).toBe(actualLessonSalary(price, 2, 47.5));
    expect(actualSalaryBase(price, 3, 72000)?.capped).toBe(false);
  });
  it("청구액을 모르면(미확정·청구서 없음) 깎지 않는다 — 모름을 0으로 읽지 않는다", () => {
    expect(actualLessonSalary(price, 4, 47.5, null)).toBe(41541.6);
    expect(actualLessonSalary(price, 4, 47.5, undefined)).toBe(41541.6);
  });
  it("청구액 0이면 실급여 0(받은 돈이 없다)", () => {
    expect(actualLessonSalary(price, 4, 47.5, 0)).toBe(0);
  });
  it("단가가 없으면 청구액이 있어도 계산하지 않는다", () => {
    expect(actualLessonSalary([{ ...price[0]!, monthly: true }], 4, 47.5, 72000)).toBeNull();
  });
});

describe("나눠 맡는 줄의 상한 = 이 선생님 몫의 청구액(salaryBilledCap)", () => {
  const price = [{ unitPrice: 24_000, monthly: false, daysBasis: false }];
  it("두 선생님이 반씩 — 청구 72,000을 36,000씩으로 깎아 합쳐도 받은 돈을 넘지 않는다", () => {
    const term = { units: 1.5, classUnits: 3, daysBasis: false };
    expect(salaryBilledCap(72_000, term)).toBe(36_000);
    // 실수업 2T(48,000) > 36,000 → 36,000 기준. 두 사람 합 = 72,000 기준(종전은 96,000).
    expect(actualLessonSalary(price, 2, 50, salaryBilledCap(72_000, term))).toBe(16_398);
  });
  it("혼자 맡는 줄(몫으로 안 나뉨)은 청구액 그대로", () => {
    expect(salaryBilledCap(72_000, { units: 3, daysBasis: false })).toBe(72_000);
    expect(salaryBilledCap(72_000, null)).toBe(72_000);
  });
  it("몫을 모르면(배분 대기) 전체 청구액 — 한 선생님 기준으로는 여전히 받은 돈 이하", () => {
    expect(salaryBilledCap(72_000, { units: 3, classUnits: 3, daysBasis: false, allocationPending: true })).toBe(72_000);
  });
  it("청구액을 모르면 상한 없음(undefined)", () => {
    expect(salaryBilledCap(null, { units: 1.5, classUnits: 3, daysBasis: false })).toBeUndefined();
    expect(salaryBilledCap(undefined, undefined)).toBeUndefined();
  });
});
