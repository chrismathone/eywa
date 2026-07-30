import { describe, expect, it } from "vitest";
import { autoJobTitle, jobTitlesForDepartment } from "./department-job-titles";

const BY_DEPT = {
  영어과: ["분원장", "부원장", "교수부장", "전임강사", "파트강사", "프리랜서"],
  경영지원팀: ["부장", "과장", "대리", "사원"],
  아르바이트: ["아르바이트"],
};
const COMMON = ["원장", "부원장", "실장", "강사"];

describe("jobTitlesForDepartment", () => {
  it("부서 전용 목록이 있으면 그 목록", () => {
    expect(jobTitlesForDepartment("영어과", BY_DEPT, COMMON)).toEqual(BY_DEPT.영어과);
    expect(jobTitlesForDepartment("경영지원팀", BY_DEPT, COMMON)).toEqual(BY_DEPT.경영지원팀);
  });

  it("부서 전용 목록이 없으면 공통 직급으로 폴백", () => {
    expect(jobTitlesForDepartment("차량팀", BY_DEPT, COMMON)).toEqual(COMMON);
    expect(jobTitlesForDepartment("", BY_DEPT, COMMON)).toEqual(COMMON);
    expect(jobTitlesForDepartment(null, BY_DEPT, COMMON)).toEqual(COMMON);
  });

  it("설정이 비었으면 빈 배열(코드에 값이 없다)", () => {
    expect(jobTitlesForDepartment("영어과", undefined, [])).toEqual([]);
    expect(jobTitlesForDepartment("영어과", {}, [])).toEqual([]);
  });

  it("빈 문자열·공백·중복은 걸러낸다", () => {
    expect(jobTitlesForDepartment("A", { A: [" 부장 ", "", "  ", "부장", "과장"] }, COMMON)).toEqual([
      "부장",
      "과장",
    ]);
  });
});

describe("autoJobTitle", () => {
  it("선택지가 하나면 자동 확정", () => {
    expect(autoJobTitle(["아르바이트"])).toBe("아르바이트");
  });

  it("여러 개거나 없으면 자동 확정하지 않는다", () => {
    expect(autoJobTitle(BY_DEPT.영어과)).toBeNull();
    expect(autoJobTitle([])).toBeNull();
  });
});
