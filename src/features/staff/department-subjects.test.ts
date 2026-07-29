import { describe, expect, it } from "vitest";
import { subjectsFromDepartment } from "./department-subjects";

// injaewon 실제 학원설정 과목(라벨 단일 소스).
const OPTIONS = [
  { value: "math", label: "수학" },
  { value: "english", label: "영어" },
  { value: "science", label: "과학" },
  { value: "korean", label: "국어" },
];

describe("subjectsFromDepartment", () => {
  it("교과 부서는 같은 이름의 과목으로 도출된다", () => {
    expect(subjectsFromDepartment("영어과", OPTIONS)).toEqual(["english"]);
    expect(subjectsFromDepartment("수학과", OPTIONS)).toEqual(["math"]);
    expect(subjectsFromDepartment("국어과", OPTIONS)).toEqual(["korean"]);
  });

  it("두 과목이 붙은 부서는 둘 다 도출된다(설정 순서)", () => {
    expect(subjectsFromDepartment("수학/과학과", OPTIONS)).toEqual(["math", "science"]);
  });

  it("교과가 아닌 부서는 담당 과목 없음", () => {
    for (const d of ["EIE", "경영지원팀", "경영팀", "개발팀", "아르바이트", "차량팀", "청소용역"]) {
      expect(subjectsFromDepartment(d, OPTIONS)).toEqual([]);
    }
  });

  it("빈 값·공백·null은 빈 배열", () => {
    expect(subjectsFromDepartment("", OPTIONS)).toEqual([]);
    expect(subjectsFromDepartment("   ", OPTIONS)).toEqual([]);
    expect(subjectsFromDepartment(null, OPTIONS)).toEqual([]);
    expect(subjectsFromDepartment(undefined, OPTIONS)).toEqual([]);
  });

  it("설정에 없는 과목은 도출되지 않는다(설정 단일 소스)", () => {
    expect(subjectsFromDepartment("과학과", [{ value: "math", label: "수학" }])).toEqual([]);
  });

  it("1글자 라벨은 우연 일치를 막기 위해 무시한다", () => {
    expect(subjectsFromDepartment("경영지원팀", [{ value: "x", label: "영" }])).toEqual([]);
  });

  it("같은 과목이 여러 번 걸려도 한 번만 담는다", () => {
    expect(
      subjectsFromDepartment("영어과", [
        { value: "english", label: "영어" },
        { value: "english", label: "영어" },
      ]),
    ).toEqual(["english"]);
  });
});
