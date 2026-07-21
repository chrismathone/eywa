import { describe, it, expect } from "vitest";
import { parseHomeworkScore, averageHomeworkScore } from "./homework-score";

describe("parseHomeworkScore", () => {
  it("edutrix 임포트 퍼센트 문자열을 숫자로", () => {
    expect(parseHomeworkScore("100%")).toBe(100);
    expect(parseHomeworkScore("90%")).toBe(90);
    expect(parseHomeworkScore("50%")).toBe(50);
  });

  it("0%(미제출)는 0 — null(기록 없음)과 반드시 구분", () => {
    expect(parseHomeworkScore("0%")).toBe(0);
    expect(parseHomeworkScore("미제출")).toBe(0);
  });

  it("원스크린 선택지(완료/일부 미흡/미제출)를 이행률로", () => {
    expect(parseHomeworkScore("완료")).toBe(100);
    expect(parseHomeworkScore("일부 미흡")).toBe(50);
    expect(parseHomeworkScore("미제출")).toBe(0);
  });

  it("% 없는 숫자·공백도 허용", () => {
    expect(parseHomeworkScore("80")).toBe(80);
    expect(parseHomeworkScore(" 70 % ")).toBe(70);
  });

  it("미기재는 null — '기록 없음' 사유는 이때만 붙어야 한다", () => {
    expect(parseHomeworkScore(null)).toBeNull();
    expect(parseHomeworkScore(undefined)).toBeNull();
    expect(parseHomeworkScore("")).toBeNull();
    expect(parseHomeworkScore("  ")).toBeNull();
    expect(parseHomeworkScore("—")).toBeNull();
    expect(parseHomeworkScore("-")).toBeNull();
  });

  it("해석 불가 자유텍스트는 null(0으로 오판해 위험점수 부풀리지 않음)", () => {
    expect(parseHomeworkScore("확인 필요")).toBeNull();
    expect(parseHomeworkScore("ㅇㅇ")).toBeNull();
  });

  it("범위를 벗어난 값은 0~100으로 클램프", () => {
    expect(parseHomeworkScore("120%")).toBe(100);
    expect(parseHomeworkScore("999")).toBe(100);
  });
});

describe("averageHomeworkScore", () => {
  it("파싱 가능한 값만 평균", () => {
    expect(averageHomeworkScore(["100%", "50%"])).toBe(75);
    expect(averageHomeworkScore(["완료", "미제출"])).toBe(50);
  });

  it("미기재는 평균에서 제외(0으로 세지 않음)", () => {
    expect(averageHomeworkScore(["100%", null, "—", ""])).toBe(100);
  });

  it("0%는 평균에 포함", () => {
    expect(averageHomeworkScore(["100%", "0%"])).toBe(50);
  });

  it("하나도 없으면 null", () => {
    expect(averageHomeworkScore([])).toBeNull();
    expect(averageHomeworkScore([null, "—", "확인 필요"])).toBeNull();
  });
});
