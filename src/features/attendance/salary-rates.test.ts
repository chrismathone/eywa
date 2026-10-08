import { describe, expect, it } from "vitest";
import { actualLessonSalary, actualSalaryBase, attendanceRateLevel, attendanceSalaryRate, parseAttendanceRates, salaryBilledCap, salaryRowOutOfScope, type AttendanceSalaryRates } from "./salary-rates";
const cls = "aaaaaaaa-1111-1111-1111-111111111111";
const rates: AttendanceSalaryRates = { regular: { 초등: 40, 중등: 45, 고등: 50 }, special: { 초등: 55, 중등: 60, 고등: 65 }, classes: {} };

describe("regular/special × student grade rates", () => {
  it("특강 예외는 이 선생님에게만 적용하며 이름·토글 모두 지원한다", () => {
    const scoped: AttendanceSalaryRates = { ...rates, levels: ["고등"], includeSpecial: true };
    for (const grade of ["초5", "중3", "고1"]) {
      const row = { classId: cls, className: "주말내신특강(중3) (~26.09.19)", grade };
      expect(salaryRowOutOfScope(scoped, grade, row)).toBe(false);
      expect(attendanceSalaryRate(scoped, row)).toBe(rates.special[attendanceRateLevel(grade)!]);
      expect(attendanceSalaryRate(scoped, { ...row, className: "방학 완성", isSpecial: true })).toBe(rates.special[attendanceRateLevel(grade)!]);
    }
    expect(attendanceSalaryRate(scoped, { classId: cls, className: "고등M", grade: "중3" })).toBeNull();
    expect(attendanceSalaryRate({ ...scoped, includeSpecial: false }, { classId: cls, className: "내신특강", grade: "중3" })).toBeNull();
  });
  it("학년을 모르는 특강은 비율이 세 학년 모두 같거나 반별로 확정되어야 한다", () => {
    const scoped: AttendanceSalaryRates = { ...rates, levels: ["고등"], includeSpecial: true };
    const row = { classId: cls, className: "내신특강", grade: null };
    expect(attendanceSalaryRate(scoped, row)).toBeNull();
    expect(attendanceSalaryRate({ ...scoped, special: { 초등: 50, 중등: 50, 고등: 50 } }, row)).toBe(50);
    expect(attendanceSalaryRate({ ...scoped, classes: { [cls]: 0 } }, row)).toBe(0);
    expect(attendanceSalaryRate(scoped, { ...row, className: "정규" })).toBeNull();
  });
  it("특강 예외 저장값은 boolean만 받고, 기존 설정의 기본 동작을 바꾸지 않는다", () => {
    expect(parseAttendanceRates({ ...rates, includeSpecial: true })?.includeSpecial).toBe(true);
    expect(parseAttendanceRates({ ...rates, includeSpecial: false })).toEqual(rates);
    for (const includeSpecial of ["true", 1, null, []]) expect(parseAttendanceRates({ ...rates, includeSpecial })).toBeNull();
  });
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

/**
 * 원장 2026-10-07 *"이성우 선생님은 특이케이스로 고등학생에 대해서만 프리랜서 적용할거라 고등학생에 대해서만 급여 명세서가
 * 나오도록 해줘"* — 선생님마다 고르는 **대상 학년**. 기준은 학생 학년이다(반 이름이 아니다).
 */
describe("대상 학년(levels) — 고른 학년의 학생만 실급여를 계산한다", () => {
  const high: AttendanceSalaryRates = { ...rates, levels: ["고등"] };
  const row = (grade: string | null, className = "고등M 단체 BS4F") => ({ classId: cls, className, grade });

  it("대상 학년 학생은 종전 그대로, 그 밖 학년은 비율이 없다 — '고등M' 반의 중3도 대상이 아니다", () => {
    expect(attendanceSalaryRate(high, row("고2"))).toBe(50);
    expect(attendanceSalaryRate(high, { ...row("고1"), isSpecial: true })).toBe(65);
    expect(attendanceSalaryRate(high, row("중3"))).toBeNull();
    expect(attendanceSalaryRate(high, row("초6", "중등M 중1 BS2F"))).toBeNull();
    expect(salaryRowOutOfScope(high, "중3")).toBe(true);
    expect(salaryRowOutOfScope(high, "고3")).toBe(false);
  });

  it("🔴 반별 예외 비율이 다른 학년 학생을 되살리지 않는다 — 학년을 먼저 본다", () => {
    const withClass: AttendanceSalaryRates = { ...high, classes: { [cls]: 47.5 } };
    expect(attendanceSalaryRate(withClass, row("고2"))).toBe(47.5);
    expect(attendanceSalaryRate(withClass, row("중3"))).toBeNull();
  });

  it("🔴 학년을 모르는 학생 — 대상 밖으로 말없이 빼지도, 확인 없이 지급하지도 않는다(비율 없음 = '빠진 줄'로 드러난다)", () => {
    expect(salaryRowOutOfScope(high, null)).toBe(false);
    expect(attendanceSalaryRate(high, row(null))).toBeNull();
    // 반별 예외가 있어도 마찬가지다 — 고등학생인지 확인되지 않았다.
    expect(attendanceSalaryRate({ ...high, classes: { [cls]: 47.5 } }, row(null))).toBeNull();
    // 대상을 좁히지 않은 선생님은 종전 그대로(학년을 몰라도 반별 예외 비율은 쓴다).
    expect(attendanceSalaryRate({ ...rates, classes: { [cls]: 47.5 } }, row(null))).toBe(47.5);
  });

  it("대상을 좁히지 않은 선생님은 아무것도 달라지지 않는다", () => {
    for (const grade of ["초5", "중2", "고3", null]) expect(salaryRowOutOfScope(rates, grade)).toBe(false);
    expect(attendanceSalaryRate(rates, row("중3"))).toBe(45);
    expect(attendanceRateLevel("고1")).toBe("고등");
    expect(attendanceRateLevel("초3")).toBe("초등");
    expect(attendanceRateLevel(null)).toBeNull();
  });

  it("저장 검증 — 순서를 맞추고, 세 학년 전부는 '전체'라 저장하지 않으며, 빈 목록·모르는 값은 거절한다", () => {
    expect(parseAttendanceRates({ ...rates, levels: ["고등", "중등"] })?.levels).toEqual(["중등", "고등"]);
    expect(parseAttendanceRates({ ...rates, levels: ["고등"] })).toEqual({ ...rates, levels: ["고등"] });
    expect(parseAttendanceRates({ ...rates, levels: ["초등", "중등", "고등"] })).toEqual(rates);
    expect("levels" in parseAttendanceRates({ ...rates, levels: ["초등", "중등", "고등"] })!).toBe(false);
    expect(parseAttendanceRates({ ...rates, levels: [] })).toBeNull();
    expect(parseAttendanceRates({ ...rates, levels: ["수능"] })).toBeNull();
    expect(parseAttendanceRates({ ...rates, levels: "고등" })).toBeNull();
    // 칸이 없는 옛 저장값은 전체다.
    expect(parseAttendanceRates(rates)?.levels).toBeUndefined();
  });
});
