import { describe, it, expect } from "vitest";
import { splitNumberedItems } from "./split-numbered";

describe("splitNumberedItems", () => {
  it("인라인 번호 나열을 항목별 줄로 분리(마커 보존)", () => {
    expect(
      splitNumberedItems("1.함수의 극한 2.함수의 좌극한과 우극한 3.함수의 극한값의 계산"),
    ).toEqual(["1.함수의 극한", "2.함수의 좌극한과 우극한", "3.함수의 극한값의 계산"]);
  });

  it("괄호 번호(N))·마커 뒤 공백도 지원", () => {
    expect(splitNumberedItems("1) 극한 2) 연속")).toEqual(["1) 극한", "2) 연속"]);
    expect(splitNumberedItems("1. 극한 2. 연속")).toEqual(["1. 극한", "2. 연속"]);
  });

  it("서두 텍스트는 첫 줄로 보존", () => {
    expect(splitNumberedItems("수학(상) 진도 1.다항식 2.방정식")).toEqual([
      "수학(상) 진도",
      "1.다항식",
      "2.방정식",
    ]);
  });

  it("소수점은 마커가 아님(3.5 등) — 분리 안 함", () => {
    expect(splitNumberedItems("쎈 3.5단원 p.120 4.5단원 복습")).toEqual([
      "쎈 3.5단원 p.120 4.5단원 복습",
    ]);
  });

  it("비연속 번호·마커 1개는 원문 유지(오탐 방지)", () => {
    expect(splitNumberedItems("1.극한 5.적분")).toEqual(["1.극한 5.적분"]);
    expect(splitNumberedItems("2.함수 단원 복습")).toEqual(["2.함수 단원 복습"]);
  });

  it("1이 아닌 번호로 시작해도 연속이면 분리(이어하기 진도)", () => {
    expect(splitNumberedItems("3.수열의 극한 4.급수")).toEqual(["3.수열의 극한", "4.급수"]);
  });

  it("이미 줄바꿈이 있으면 그 줄바꿈 우선", () => {
    expect(splitNumberedItems("극한 복습\n연속 예습")).toEqual(["극한 복습", "연속 예습"]);
  });

  it("단어에 붙은 숫자(중2.반)는 마커 아님 — 공백 경계 필수", () => {
    expect(splitNumberedItems("중2.함수 진도 나감 중3.공통수학 예습")).toEqual([
      "중2.함수 진도 나감 중3.공통수학 예습",
    ]);
  });
});
