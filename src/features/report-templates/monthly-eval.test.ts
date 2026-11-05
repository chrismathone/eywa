import { describe, expect, it } from "vitest";
import { buildMonthlyEval, monthlyEvalMarker, monthlyEvalOfLine, monthlyEvalOfText, type MonthlyEval } from "./monthly-eval";
import { hasTextBesidesMarkers, splitImageSlots, stripImageSlots } from "./image-slots";

const EV: MonthlyEval = {
  month: "2026-10",
  areaMax: 100,
  areas: {
    writing: { score: 70, average: 95 },
    speaking: { score: 90, average: 97 },
    reading: { score: 80, average: 96 },
    listening: { score: 90, average: null },
  },
};

describe("월간 점수 줄", () => {
  it("만든 줄을 그대로 다시 읽는다(시트 순서 W·S·R·L)", () => {
    const line = monthlyEvalMarker(EV);
    expect(line).toBe("[월간평가 2026-10 | 만점 100 | W 70/95 | S 90/97 | R 80/96 | L 90/-]");
    expect(monthlyEvalOfLine(line)).toEqual(EV);
    expect(monthlyEvalOfLine(`  ${line}  `)).toEqual(EV);
  });

  it("모양이 어긋나면 자리가 아니다(문장 속 글자·영역 빠짐)", () => {
    expect(monthlyEvalOfLine(`이번 달 ${monthlyEvalMarker(EV)}`)).toBeNull();
    expect(monthlyEvalOfLine("[월간평가 2026-10 | 만점 100 | W 70/95 | S 90/97 | R 80/96]")).toBeNull();
    expect(monthlyEvalOfLine("[월간평가 2026-10 | 만점 0 | W 1/1 | S 1/1 | R 1/1 | L 1/1]")).toBeNull();
  });

  it("자리 줄이라 학부모 글에서 빠지고, 점수 줄만 있으면 빈 멘트다", () => {
    const notes = `${monthlyEvalMarker(EV)}\n\n이번 달 잘했어요.`;
    expect(stripImageSlots(notes)).toBe("이번 달 잘했어요.");
    expect(hasTextBesidesMarkers(monthlyEvalMarker(EV))).toBe(false);
    expect(splitImageSlots(notes)[0]).toEqual({ kind: "monthly", eval: EV });
    expect(monthlyEvalOfText(notes)).toEqual(EV);
  });
});

describe("buildMonthlyEval", () => {
  const rows = [
    { student_id: "a", taken_on: "2026-10-30", max_score: 100, area_scores: { writing: 20, speaking: 25, reading: 15, listening: 25 } },
    { student_id: "b", taken_on: "2026-10-30", max_score: 100, area_scores: { writing: 10, speaking: 20, reading: 20 } },
    { student_id: "c", taken_on: "2026-10-30", max_score: 100, area_scores: null },
  ];

  it("영역 만점 = 총합 만점 ÷ 4 · 평균 = 그 영역 점수가 있는 학생만", () => {
    const ev = buildMonthlyEval(rows, "a", "2026-10")!;
    expect(ev.areaMax).toBe(25);
    expect(ev.areas.writing).toEqual({ score: 20, average: 15 });
    expect(ev.areas.listening).toEqual({ score: 25, average: 25 });
    expect(buildMonthlyEval(rows, "b", "2026-10")!.areas.listening).toEqual({ score: null, average: 25 });
  });

  it("점수가 없거나 만점을 모르면 null(그래프를 지어내지 않는다)", () => {
    expect(buildMonthlyEval(rows, "c", "2026-10")).toBeNull();
    expect(buildMonthlyEval(rows, "zz", "2026-10")).toBeNull();
    expect(buildMonthlyEval([{ ...rows[0]!, max_score: null }], "a", "2026-10")).toBeNull();
  });
});
