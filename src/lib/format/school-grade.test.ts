import { describe, expect, it } from "vitest";
import {
  formatSchoolGrade,
  getGradeLevel,
  getGradeNumber,
  isPreschoolGrade,
  schoolGradeLabel,
} from "./school-grade";

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

describe("미취학(7세·6세) — 급간이 없는 학년", () => {
  it("숫자만 뽑아 붙이지 않는다 — 학교와 띄어 적는다", () => {
    expect(schoolGradeLabel("Ing유치원", "7세")).toBe("Ing유치원 7세");
    expect(schoolGradeLabel("미취학", "6세")).toBe("미취학 6세");
  });
  it("학교칸에도 같은 나이를 적었으면 학교만", () => {
    expect(schoolGradeLabel("7세", "7세")).toBe("7세");
  });
  it("한쪽만 있으면 그것만", () => {
    expect(schoolGradeLabel(null, "7세")).toBe("7세");
    expect(schoolGradeLabel("Ing유치원", null)).toBe("Ing유치원");
  });
  it("초/중/고는 종전 그대로", () => {
    expect(schoolGradeLabel("옥산초", "초3")).toBe("옥산초3");
  });
});

describe("isPreschoolGrade", () => {
  it("나이·미취학·유치 표기만 참", () => {
    for (const g of ["7세", "6세", "미취학", "유치원", "유치"]) expect(isPreschoolGrade(g), g).toBe(true);
    for (const g of ["초1", "중3", "고2", "기타", "", null, undefined]) expect(isPreschoolGrade(g), String(g)).toBe(false);
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
