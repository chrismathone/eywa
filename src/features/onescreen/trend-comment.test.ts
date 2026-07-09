import { describe, it, expect } from "vitest";
import { buildTrendInput, buildTrendPrompt, MIN_TREND_RECORDS, type TrendHistoryRow } from "./trend-comment";

const row = (date: string, examInfo: string | null, homeworkScore: string | null): TrendHistoryRow => ({
  date,
  examInfo,
  homeworkScore,
});

describe("buildTrendInput", () => {
  it("날짜순 시험·과제 흐름을 [MM-DD] 값 -> 규격으로 조립", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "일부 미흡"),
    ]);
    expect(input).not.toBeNull();
    expect(input!.count).toBe(2);
    expect(input!.examTrend).toBe("[06-01] 일일 6/10 -> [06-08] 일일 8/10");
    expect(input!.assignTrend).toBe("[06-01] 완료 -> [06-08] 일부 미흡");
  });

  it("최근 10회만 사용(초과분은 앞에서 잘림)", () => {
    const many = Array.from({ length: 13 }, (_, i) =>
      row(`2026-06-${String(i + 1).padStart(2, "0")}`, `일일 ${i}/10`, null),
    );
    const input = buildTrendInput(many);
    expect(input!.count).toBe(10);
    // 앞 3개(01~03)는 잘리고 04부터 시작
    expect(input!.examTrend.startsWith("[06-04]")).toBe(true);
    expect(input!.examTrend.endsWith("[06-13] 일일 12/10")).toBe(true);
  });

  it("유효 데이터 < MIN_TREND_RECORDS면 null(빈데이터 창작 방지)", () => {
    expect(MIN_TREND_RECORDS).toBe(2);
    expect(buildTrendInput([row("2026-06-01", "일일 6/10", null)])).toBeNull(); // 1개뿐
    expect(buildTrendInput([row("2026-06-01", null, null), row("2026-06-08", "  ", "  ")])).toBeNull(); // 전부 공백
    expect(buildTrendInput([])).toBeNull();
  });

  it("시험만 있고 과제 전무여도 조립(과제는 '자료 없음')", () => {
    const input = buildTrendInput([row("2026-06-01", "일일 6/10", null), row("2026-06-08", "일일 8/10", null)]);
    expect(input!.examTrend).not.toBe("");
    expect(input!.assignTrend).toBe("");
  });
});

describe("buildTrendPrompt", () => {
  it("숫자 정확·전망 금지·JSON 계약·기록 주입", () => {
    const input = buildTrendInput([
      row("2026-06-01", "일일 6/10", "완료"),
      row("2026-06-08", "일일 8/10", "완료"),
    ])!;
    const p = buildTrendPrompt(input);
    expect(p).toContain('{"trend": "..."}'); // 출력 계약
    expect(p).toContain("Y문제 중 X문제"); // 숫자 정확 규칙
    expect(p).toContain("전망·격려·조언은 넣지 마세요");
    expect(p).toContain("[06-01] 일일 6/10 -> [06-08] 일일 8/10"); // 기록 주입
    expect(p).toContain("과제 흐름(날짜순): [06-01] 완료 -> [06-08] 완료");
  });
});
