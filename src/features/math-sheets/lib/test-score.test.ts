import { describe, expect, it } from "vitest";
import { dailyTestPercent, testScoresOf } from "./test-score";

const S = (dailyTest: string | null, checkTest: string | null, examInfo: string | null) => ({
  dailyTest,
  checkTest,
  examInfo,
});

describe("testScoresOf — 일일·확인·옛 합본", () => {
  it("실데이터 표기 둘 다 읽는다 — '22문제 중 21개' · '5문제 중 4개 맞음'", () => {
    expect(testScoresOf(S("22문제 중 21개", null, null))).toEqual([{ kind: "daily", raw: "22문제 중 21개", pct: 95 }]);
    expect(testScoresOf(S("5문제 중 4개 맞음", null, null))).toEqual([
      { kind: "daily", raw: "5문제 중 4개 맞음", pct: 80 },
    ]);
  });

  it("확인테스트는 일일 뒤에 따로 선다", () => {
    expect(testScoresOf(S("10문제 중 8개", "20문제 중 19개", null))).toEqual([
      { kind: "daily", raw: "10문제 중 8개", pct: 80 },
      { kind: "check", raw: "20문제 중 19개", pct: 95 },
    ]);
  });

  it("🔴 분리값이 하나라도 있으면 옛 합본은 안 읽는다 — 원스크린은 둘 다 써서 같은 점수가 두 번 서면 안 된다", () => {
    expect(testScoresOf(S("5문제 중 5개", null, "일일 5/5"))).toHaveLength(1);
  });

  it("옛 합본(edutrix 이관) — 라벨 붙은 조각은 그 종류로, 라벨 없는 맨 분수는 '시험'으로", () => {
    expect(testScoresOf(S(null, null, "일일 4/5"))).toEqual([{ kind: "daily", raw: "4/5", pct: 80 }]);
    expect(testScoresOf(S(null, null, "일일 18/20 확인 19/20"))).toEqual([
      { kind: "daily", raw: "18/20", pct: 90 },
      { kind: "check", raw: "19/20", pct: 95 },
    ]);
    expect(testScoresOf(S(null, null, "4/5"))).toEqual([{ kind: "legacy", raw: "4/5", pct: 80 }]);
  });

  it("빈 값·공백은 아무것도 세우지 않는다", () => {
    expect(testScoresOf(S(null, null, null))).toEqual([]);
    expect(testScoresOf(S("  ", "", " "))).toEqual([]);
  });

  it("읽을 수 없는 표기는 원문만 남기고 백분율은 null", () => {
    expect(testScoresOf(S("미응시", null, null))).toEqual([{ kind: "daily", raw: "미응시", pct: null }]);
  });
});

describe("dailyTestPercent — 평균의 재료", () => {
  it("분리값 > 옛 합본의 '일일' 조각 > 없음", () => {
    expect(dailyTestPercent(S("5문제 중 4개", null, null))).toBe(80);
    expect(dailyTestPercent(S(null, null, "일일 9/10"))).toBe(90);
    expect(dailyTestPercent(S(null, "10문제 중 10개", null))).toBeNull();
  });

  it("🔴 라벨 없는 맨 분수는 일일 평균에 넣지 않는다 — 무엇의 점수인지 모른다", () => {
    expect(dailyTestPercent(S(null, null, "4/5"))).toBeNull();
  });
});
