import { describe, expect, it } from "vitest";
import { hasSpecialLectureName, isSpecialLecture } from "./special-lecture";
import { autoSalaryGroup } from "@/features/payroll/salary-group";

describe("hasSpecialLectureName — 이름 폴백(하위호환)", () => {
  it("접두어가 아니라 포함으로 본다", () => {
    expect(hasSpecialLectureName("겨울 특강")).toBe(true);
    expect(hasSpecialLectureName("고등M 수능특강")).toBe(true);
    expect(hasSpecialLectureName("  특강A  ")).toBe(true);
  });
  it("근거 없으면 false", () => {
    expect(hasSpecialLectureName("고등M 고1 BS4F 토")).toBe(false);
    expect(hasSpecialLectureName("JP1")).toBe(false);
    expect(hasSpecialLectureName("")).toBe(false);
    expect(hasSpecialLectureName(null)).toBe(false);
    expect(hasSpecialLectureName(undefined)).toBe(false);
  });
});

describe("isSpecialLecture — 컬럼 우선, 없으면 이름 폴백", () => {
  it("컬럼 true면 이름과 무관하게 특강", () => {
    expect(isSpecialLecture({ isSpecial: true, className: "JP1" })).toBe(true);
  });
  it("컬럼 false여도 이름에 '특강'이면 특강(기존 반 하위호환)", () => {
    expect(isSpecialLecture({ isSpecial: false, className: "겨울 특강" })).toBe(true);
  });
  it("컬럼 미상(null/undefined)이면 이름만 본다", () => {
    expect(isSpecialLecture({ className: "겨울 특강" })).toBe(true);
    expect(isSpecialLecture({ isSpecial: null, className: "JP1" })).toBe(false);
  });
  it("둘 다 아니면 정규", () => {
    expect(isSpecialLecture({ isSpecial: false, className: "중등M 중2 EL3N" })).toBe(false);
    expect(isSpecialLecture({})).toBe(false);
  });
});

describe("급여 autoSalaryGroup과 판정이 갈리지 않는다", () => {
  // 시간표와 급여가 다른 규칙을 쓰면 "시간표엔 특강인데 급여엔 아닌 반"이 생긴다.
  it.each(["겨울 특강", "고등M 수능특강", "특강", "여름특강 고3"])("%s → 양쪽 모두 특강", (n) => {
    expect(hasSpecialLectureName(n)).toBe(true);
    expect(autoSalaryGroup(n)).toBe("특강");
  });
  it("이름에 근거 없는 반은 양쪽 모두 특강이 아니다(급여 동작 불변)", () => {
    expect(hasSpecialLectureName("고3 수능반")).toBe(false);
    expect(autoSalaryGroup("고3 수능반")).toBe("수능");
  });
});
