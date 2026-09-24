import { describe, expect, it } from "vitest";
import { splitProgressItems } from "./progress-cell";

describe("splitProgressItems — 긴 진도를 차시마다 한 줄로", () => {
  it("단원 번호마다 나누고 과목 머리는 첫 차시에 붙인다", () => {
    expect(splitProgressItems("수학 2-2-1 자릿수가 같은 (소수)÷(소수) 알아보기 2-2-2 자릿수가 다른 (소수)÷(소수) 알아보기 2-3-3 쌓기나무 (1)"))
      .toEqual(["수학 2-2-1 자릿수가 같은 (소수)÷(소수) 알아보기", "2-2-2 자릿수가 다른 (소수)÷(소수) 알아보기", "2-3-3 쌓기나무 (1)"]);
  });
  it("번호가 하나뿐이거나 없으면 나누지 않는다", () => {
    expect(splitProgressItems("수학 일차방정식의 활용(도형, 농도, 일)")).toEqual(["수학 일차방정식의 활용(도형, 농도, 일)"]);
    expect(splitProgressItems("교재 1-2 p.30")).toEqual(["교재 1-2 p.30"]);
  });
});
