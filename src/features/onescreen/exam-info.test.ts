import { describe, it, expect } from "vitest";
import { parseExamScores, parseExamMaxes } from "./exam-info";

// 분모(척도) 파서(0148a) — roster가 직전 회차와 오늘의 척도 일치를 확인해 척도경계 허위 delta를 막는 데 쓴다.
describe("parseExamMaxes", () => {
  it("일일·확인 분모(만점)를 뽑는다", () => {
    expect(parseExamMaxes("일일 18/20, 확인 19/20")).toEqual({ daily: 20, check: 20 });
  });
  it("점수 모드(만점 100)와 개수 모드(문항수 20)를 구분한다 — 척도 비교의 근거", () => {
    expect(parseExamMaxes("일일 95/100").daily).toBe(100);
    expect(parseExamMaxes("일일 18/20").daily).toBe(20);
  });
  it("없거나 형식 불일치는 null", () => {
    expect(parseExamMaxes(null)).toEqual({ daily: null, check: null });
    expect(parseExamMaxes("일일 완료")).toEqual({ daily: null, check: null });
  });
});

describe("parseExamScores", () => {
  it("일일·확인 둘 다", () => {
    expect(parseExamScores("일일 18/20, 확인 19/20")).toEqual({ daily: 18, check: 19 });
  });
  it("일일만", () => {
    expect(parseExamScores("일일 18/20")).toEqual({ daily: 18, check: null });
  });
  it("확인만", () => {
    expect(parseExamScores("확인 19/20")).toEqual({ daily: null, check: 19 });
  });
  it("빈 문자열", () => {
    expect(parseExamScores("")).toEqual({ daily: null, check: null });
  });
  it("null/undefined", () => {
    expect(parseExamScores(null)).toEqual({ daily: null, check: null });
    expect(parseExamScores(undefined)).toEqual({ daily: null, check: null });
  });
  it("0점·공백 변형", () => {
    expect(parseExamScores("일일 0/20,  확인 5 / 20")).toEqual({ daily: 0, check: 5 });
  });
  it("무관 텍스트는 무시", () => {
    expect(parseExamScores("과제 완료")).toEqual({ daily: null, check: null });
  });
});
