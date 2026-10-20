import { describe, it, expect } from "vitest";
import { NONE_LABEL, normalizeNoneMarker, isNoneValue } from "./none-marker";
import { buildTrendInput, type TrendHistoryRow } from "./trend-comment";
import { parseHomeworkPercent } from "./report-trend";
import { parseHomeworkRate } from "./homework-rate";

const row = (date: string, examInfo: string | null, homeworkScore: string | null): TrendHistoryRow => ({
  date,
  examInfo,
  homeworkScore,
});

describe("normalizeNoneMarker — 자리표시자를 '없음' 하나로", () => {
  // 실측(2026-07-23): homework_today에 '-' 25건 · '없음' 40건 · 'X' 2건이 섞여 있었다.
  it.each(["-", "–", "—", "X", "x", "없음", "없슴", "무", "N/A", " - "])("%s → 없음", (v) => {
    expect(normalizeNoneMarker(v)).toBe(NONE_LABEL);
  });
  it("빈 값은 null(항목 자체를 안 내보냄)", () => {
    expect(normalizeNoneMarker("")).toBeNull();
    expect(normalizeNoneMarker("   ")).toBeNull();
    expect(normalizeNoneMarker(null)).toBeNull();
    expect(normalizeNoneMarker(undefined)).toBeNull();
  });
  it("뜻이 다른 값은 건드리지 않는다(진짜 기록 보존)", () => {
    expect(normalizeNoneMarker("미제출")).toBe("미제출");
    expect(normalizeNoneMarker("0%")).toBe("0%");
    expect(normalizeNoneMarker("일부 미흡")).toBe("일부 미흡");
    expect(normalizeNoneMarker("본책 p.55~69")).toBe("본책 p.55~69");
  });
  it("앞뒤 공백만 턴다", () => {
    expect(normalizeNoneMarker("  워크북 ~49  ")).toBe("워크북 ~49");
  });
});

describe("'없음'은 과제 수행률의 정식 값", () => {
  // 입력은 퍼센트 자유입력이라 선택지 배열이 없다(2026-08-03) — '없음' 토글이 이 값을 넣는다.
  it("숫자로 환산되지 않는다(0%가 아니다)", () => {
    expect(parseHomeworkRate(NONE_LABEL)).toBeNull();
    expect(parseHomeworkRate("0%")).toBe(0);
  });
  it("미제출과 다른 값이다", () => {
    expect(isNoneValue("없음")).toBe(true);
    expect(isNoneValue("미제출")).toBe(false);
  });
});

describe("추세에서 제외 — '없음'은 미제출이 아니다", () => {
  it("과제 흐름에서 '없음' 회차가 빠진다", () => {
    const input = buildTrendInput([
      row("2026-07-01", null, "없음"),
      row("2026-07-08", null, "완료"),
      row("2026-07-12", null, "완료"),
      row("2026-07-15", null, "완료"),
    ])!;
    // 연속 같은 값은 코드가 묶는다(compressRuns, 2026-07-30) — 모델이 날짜를 나열할 재료 자체를 줄인다.
    expect(input.assignTrend).toBe("[07-08~07-15] 완료(3회)");
    expect(input.facts).toEqual(["과제: 최근 빠짐없이 잘 해 오고 있음"]); // '없음'은 연속을 끊지도 세지도 않는다
    expect(input.assignTrend).not.toContain("없음");
  });

  it("정규화 전 이관분 표기('-'·'X')도 조립 시점에서 걸러진다", () => {
    const input = buildTrendInput([
      row("2026-07-01", "일일 6/10", "-"),
      row("2026-07-08", "일일 8/10", "X"),
      row("2026-07-15", "일일 9/10", "완료"),
    ])!;
    expect(input.assignTrend).toBe("[07-15] 완료");
    expect(input.examTrend).toContain("[07-01]"); // 시험 흐름은 그대로 살아 있어야 한다
  });

  it("'없음'만 있는 학생은 과제 흐름이 비고, 시험이 없으면 추세 자체가 생략된다", () => {
    expect(buildTrendInput([row("2026-07-01", null, "없음"), row("2026-07-08", null, "없음")])).toBeNull();
  });

  it("그래프 퍼센트에서도 제외(숫자 없는 값 → null)", () => {
    expect(parseHomeworkPercent("없음")).toBeNull();
    expect(parseHomeworkPercent("-")).toBeNull();
    expect(parseHomeworkPercent("미제출")).toBe(0); // ← 미제출은 0으로 살아 있어야 한다
    expect(parseHomeworkPercent("완료")).toBe(100);
  });
});
