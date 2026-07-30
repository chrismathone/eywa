import { describe, expect, it } from "vitest";
import { checkMentConsistency } from "./ment-consistency";

const check = (over: Partial<Parameters<typeof checkMentConsistency>[0]>) =>
  checkMentConsistency({ ment: "", progress: "", dailyTest: "", checkTest: "", ...over });

describe("① 시험 본 날인데 진도 칸은 일반 차시", () => {
  it("🔴 실사례(이유정 07-28) — 멘트는 월말평가, 진도는 분수 나눗셈 차시", () => {
    expect(
      check({
        ment: "오늘은 6학년 2학기 1-2 단원 월말평가를 진행했습니다 25문제 중 21개를 맞혔습니다",
        progress: "2-1-5 (가분수)÷(분수), (대분수)÷(분수) 알아보기",
        dailyTest: "25문제 중 21개",
      }),
    ).toContain("exam-progress");
  });

  it("진도 칸도 '월말평가'면 어긋나지 않는다(정석 입력)", () => {
    expect(check({ ment: "오늘은 월말평가를 진행했습니다", progress: "월말평가" })).toEqual([]);
  });

  it("진도가 비면 검사하지 않는다(어긋날 대상이 없다)", () => {
    expect(check({ ment: "오늘은 월말평가를 봤습니다", progress: "" })).toEqual([]);
  });

  it("시험 **대비** 수업은 시험을 본 게 아니다 — 오탐 금지", () => {
    expect(check({ ment: "다음 주 중간고사 대비로 기출을 풀었습니다", progress: "이차함수" })).toEqual([]);
    expect(check({ ment: "시험 범위를 정리했습니다", progress: "이차함수" })).toEqual([]);
  });

  it("멘트가 비면 아무것도 보고하지 않는다(미작성과 불일치는 다르다)", () => {
    expect(check({ ment: "", progress: "이차함수" })).toEqual([]);
    expect(check({ ment: "   ", progress: "이차함수" })).toEqual([]);
  });
});

describe("② 점수는 멘트에만, 테스트 칸은 빈 채", () => {
  it("🔴 실사례 — '25문제 중 21개'인데 칸이 비었다(추이에 안 남는다)", () => {
    expect(check({ ment: "25문제 중 21개를 맞혔습니다", progress: "월말평가" })).toContain("score-not-recorded");
  });

  it("칸에 들어가 있으면 정상", () => {
    expect(
      check({ ment: "25문제 중 21개를 맞혔습니다", progress: "월말평가", dailyTest: "25문제 중 21개" }),
    ).not.toContain("score-not-recorded");
    expect(
      check({ ment: "25문제 중 21개를 맞혔습니다", progress: "월말평가", checkTest: "25문제 중 21개" }),
    ).not.toContain("score-not-recorded");
  });

  it("'92점' 꼴도 점수로 본다", () => {
    expect(check({ ment: "월말평가에서 92점을 받았습니다" })).toContain("score-not-recorded");
  });

  it("점수 이야기가 없으면 조용하다", () => {
    expect(check({ ment: "오늘은 원기둥을 배웠습니다. 수업 태도가 아주 좋았습니다." })).toEqual([]);
  });

  it("교재 쪽수·과제 범위를 점수로 오해하지 않는다", () => {
    expect(check({ ment: "오늘 과제는 55-60입니다.", progress: "등비급수" })).toEqual([]);
    expect(check({ ment: "오늘 과제는 워크북 p.32까지입니다.", progress: "이차함수" })).toEqual([]);
  });
});

describe("두 갈래가 함께 잡힐 수 있다", () => {
  it("시험 멘트 + 점수 미기록", () => {
    const w = check({ ment: "오늘은 월말평가를 진행했습니다. 25문제 중 20개를 맞혔습니다.", progress: "소수의 덧셈" });
    expect(w).toEqual(["exam-progress", "score-not-recorded"]);
  });
});
