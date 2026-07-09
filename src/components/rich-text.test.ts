import { describe, it, expect } from "vitest";
import { splitTopLevelCommas } from "./rich-text";

describe("splitTopLevelCommas — 괄호 인식 쉼표 분할", () => {
  it("최상위 쉼표로 나눈다", () => {
    expect(splitTopLevelCommas("맥레벨 수강 희망, 형제 할인 적용, 데일리 리포트 제공")).toEqual([
      "맥레벨 수강 희망",
      "형제 할인 적용",
      "데일리 리포트 제공",
    ]);
  });

  it("괄호 안 쉼표는 쪼개지 않는다", () => {
    expect(
      splitTopLevelCommas("초반 적응 어려움(숙제 부담, 문법·쓰기 학습), 입시까지 시간 부족"),
    ).toEqual(["초반 적응 어려움(숙제 부담, 문법·쓰기 학습)", "입시까지 시간 부족"]);
  });

  it("전각 괄호·쉼표도 처리", () => {
    expect(splitTopLevelCommas("가（ㄱ，ㄴ），나")).toEqual(["가（ㄱ，ㄴ）", "나"]);
  });

  it("쉼표 없으면 단일 항목, 빈 항목은 제거", () => {
    expect(splitTopLevelCommas("단일 항목")).toEqual(["단일 항목"]);
    expect(splitTopLevelCommas("a, , b,")).toEqual(["a", "b"]);
  });

  it("천단위 콤마(숫자,숫자)는 쪼개지 않는다 — 288,000원 보호", () => {
    expect(splitTopLevelCommas("수업료 288,000원")).toEqual(["수업료 288,000원"]);
    expect(splitTopLevelCommas("교재비 2만원, 총 288,000원, 인강 3만원")).toEqual([
      "교재비 2만원",
      "총 288,000원",
      "인강 3만원",
    ]);
  });
});
