import { describe, expect, it } from "vitest";
import { formatSchoolGrade, getGradeLevel, getGradeNumber, schoolGradeLabel } from "./school-grade";

describe("schoolGradeLabel (표시 표준: 학교+학년 압축)", () => {
  it("학교가 초/중/고로 끝나면 숫자만 붙인다", () => {
    expect(schoolGradeLabel("경명여중", "중1")).toBe("경명여중1");
    expect(schoolGradeLabel("침산중", "중1")).toBe("침산중1");
    expect(schoolGradeLabel("옥산초", "초3")).toBe("옥산초3");
    expect(schoolGradeLabel("경명여고", "고2")).toBe("경명여고2");
  });
  it("한쪽만 있으면 그것만", () => {
    expect(schoolGradeLabel("침산중", null)).toBe("침산중");
    expect(schoolGradeLabel(null, "중1")).toBe("중1");
    expect(schoolGradeLabel("", "초6")).toBe("초6");
  });
  it("둘 다 없으면 빈 문자열(호출부 폴백 유지)", () => {
    expect(schoolGradeLabel(null, null)).toBe("");
    expect(schoolGradeLabel(" ", "")).toBe("");
  });
});

describe("formatSchoolGrade (ijw verbatim — 변경 금지)", () => {
  it("시간표 기본: 숫자 앞", () => {
    expect(formatSchoolGrade("칠성초", "초5")).toBe("5칠성초");
  });
  it("둘 다 없으면 '-'", () => {
    expect(formatSchoolGrade(null, null)).toBe("-");
  });
});

describe("getGradeNumber / getGradeLevel", () => {
  it("숫자·레벨 추출", () => {
    expect(getGradeNumber("초3")).toBe("3");
    expect(getGradeLevel("초3")).toBe("초");
    expect(getGradeLevel("고1")).toBe("고");
    expect(getGradeLevel("3")).toBe("");
  });
});
