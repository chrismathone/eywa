import { describe, expect, it } from "vitest";
import {
  applyLevelChange,
  buildClassName,
  classLevelDown,
  classLevelUp,
  DEFAULT_ENGLISH_LEVELS,
  isLevelClassName,
  isMaxLevel,
  isMinLevel,
  numberLevelDown,
  numberLevelUp,
  parseClassName,
} from "./level";

describe("parseClassName", () => {
  it("약어+숫자+접미사 분해", () => {
    expect(parseClassName("DP3")).toEqual({ levelAbbr: "DP", number: 3, suffix: "" });
    expect(parseClassName("RTT6a")).toEqual({ levelAbbr: "RTT", number: 6, suffix: "a" });
    expect(parseClassName(" LT4 ")).toEqual({ levelAbbr: "LT", number: 4, suffix: "" });
  });
  it("규칙 아닌 자유형 한글명은 null", () => {
    expect(parseClassName("고등E_고2 TOP")).toBeNull();
    expect(parseClassName("중등M 개별 JJ3H")).toBeNull();
    expect(parseClassName("")).toBeNull();
  });
  it("buildClassName 왕복", () => {
    expect(buildClassName({ levelAbbr: "DP", number: 4, suffix: "" })).toBe("DP4");
    expect(buildClassName({ levelAbbr: "RTT", number: 6, suffix: "a" })).toBe("RTT6a");
  });
});

describe("숫자 레벨업/다운", () => {
  it("up은 숫자 증가, 접미사 보존", () => {
    expect(numberLevelUp("DP3")).toBe("DP4");
    expect(numberLevelUp("RTT6a")).toBe("RTT7a");
  });
  it("down은 숫자 감소, 1이면 null", () => {
    expect(numberLevelDown("DP4")).toBe("DP3");
    expect(numberLevelDown("DP1")).toBeNull();
  });
  it("자유형은 null", () => {
    expect(numberLevelUp("고등E_고2 TOP")).toBeNull();
  });
});

describe("클래스 레벨업/다운", () => {
  it("up은 다음 레벨 + 숫자 1 리셋, 접미사 보존", () => {
    expect(classLevelUp("DP3")).toBe("PL1");
    expect(classLevelUp("RTT6a")).toBe("LT1a");
  });
  it("최상위(MEC)면 up null", () => {
    expect(classLevelUp("MEC2")).toBeNull();
    expect(isMaxLevel("MEC1")).toBe(true);
  });
  it("down은 이전 레벨 + 숫자 1 리셋", () => {
    expect(classLevelDown("PL2")).toBe("DP1");
  });
  it("최하위(DP)면 down null", () => {
    expect(classLevelDown("DP3")).toBeNull();
    expect(isMinLevel("DP3")).toBe(true);
  });
  it("목록에 없는 약어면 null", () => {
    expect(classLevelUp("ZZ1")).toBeNull();
  });
});

describe("isLevelClassName", () => {
  it("기본 12레벨 약어면 true", () => {
    expect(isLevelClassName("DP5")).toBe(true);
    expect(isLevelClassName("MEC1")).toBe(true);
  });
  it("자유형/미등록 약어면 false", () => {
    expect(isLevelClassName("고등특강(테스트)")).toBe(false);
    expect(isLevelClassName("ZZ1")).toBe(false);
  });
  it("기본 레벨은 12개 순서", () => {
    expect(DEFAULT_ENGLISH_LEVELS).toHaveLength(12);
    expect(DEFAULT_ENGLISH_LEVELS[0].abbreviation).toBe("DP");
    expect(DEFAULT_ENGLISH_LEVELS[11].abbreviation).toBe("MEC");
  });
});

describe("applyLevelChange 통합", () => {
  it("4종 변경 디스패치", () => {
    expect(applyLevelChange("DP3", "number-up")).toBe("DP4");
    expect(applyLevelChange("DP3", "number-down")).toBe("DP2");
    expect(applyLevelChange("DP1", "number-down")).toBeNull();
    expect(applyLevelChange("DP3", "class-up")).toBe("PL1");
    expect(applyLevelChange("PL1", "class-down")).toBe("DP1");
  });
});
