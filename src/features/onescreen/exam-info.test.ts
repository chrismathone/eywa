import { describe, it, expect } from "vitest";
import { parseExamScores } from "./exam-info";

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
