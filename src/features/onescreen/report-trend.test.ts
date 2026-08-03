import { describe, expect, it } from "vitest";
import {
  parseExamPercent,
  parseHomeworkPercent,
  buildTrendPoints,
  hasTrend,
  type TrendReportRow,
} from "./report-trend";

describe("parseExamPercent", () => {
  it("n/m → 백분율", () => {
    expect(parseExamPercent("4/5")).toBe(80);
    expect(parseExamPercent("9/10")).toBe(90);
    expect(parseExamPercent("10/10")).toBe(100);
    expect(parseExamPercent("3 / 6")).toBe(50);
  });
  it("N문제 중 M개 → 백분율(eywa 분리필드)", () => {
    expect(parseExamPercent("20문제 중 18개")).toBe(90);
    expect(parseExamPercent("20문제 중 19개")).toBe(95);
  });
  it("단순 숫자 폴백(80점)", () => {
    expect(parseExamPercent("80점")).toBe(80);
    expect(parseExamPercent("100")).toBe(100);
  });
  it("100 초과는 clamp, 0/m은 0", () => {
    expect(parseExamPercent("120")).toBe(100);
    expect(parseExamPercent("0/5")).toBe(0);
  });
  it("빈/무효는 null", () => {
    expect(parseExamPercent(null)).toBeNull();
    expect(parseExamPercent("")).toBeNull();
    expect(parseExamPercent("우수")).toBeNull();
  });
});

describe("parseHomeworkPercent", () => {
  it("% 숫자화", () => {
    expect(parseHomeworkPercent("100%")).toBe(100);
    expect(parseHomeworkPercent("90%")).toBe(90);
    expect(parseHomeworkPercent("0%")).toBe(0);
    expect(parseHomeworkPercent("90")).toBe(90);
  });
  it("옛 정성값 중 뜻이 분명한 것만 숫자로(완료=100·미제출=0)", () => {
    expect(parseHomeworkPercent("완료")).toBe(100);
    expect(parseHomeworkPercent("미제출")).toBe(0);
    expect(parseHomeworkPercent(" 완료 ")).toBe(100); // trim
  });

  // 🔴 회귀 잠금(2026-08-03): 여기서 50을 돌려주던 매핑이 사고를 냈다 — 90% 해온 학생이 학부모
  //    그래프에 50으로 찍혔다. 정도를 모르는 값은 **점을 찍지 않는다.** 다시 50으로 바꾸지 말 것.
  it("'일부 미흡'은 정도 미상 → null(그래프에 점을 찍지 않는다)", () => {
    expect(parseHomeworkPercent("일부 미흡")).toBeNull();
    expect(parseHomeworkPercent("미흡")).toBeNull();
  });
  it("매핑 밖 정성값·빈값은 null(그래프 제외)", () => {
    expect(parseHomeworkPercent("미확인")).toBeNull();
    expect(parseHomeworkPercent("—")).toBeNull();
    expect(parseHomeworkPercent("")).toBeNull();
    expect(parseHomeworkPercent(null)).toBeNull();
  });
});

describe("buildTrendPoints", () => {
  const rows: TrendReportRow[] = [
    { id: "b", date: "2026-07-05", examInfo: "4/5", homeworkScore: "90%" },
    { id: "a", date: "2026-07-01", examInfo: "3/5", homeworkScore: "100%" },
    { id: "c", date: "2026-07-09", examInfo: null, homeworkScore: "미확인" }, // 시험 null + 과제(매핑 밖) null → 제외
    { id: "d", date: "2026-07-07", examInfo: "5/5", homeworkScore: null },
  ];
  it("날짜 오름차순 + 무효행 제외 + 현재 표시", () => {
    const pts = buildTrendPoints(rows, "d");
    expect(pts.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-05", "2026-07-07"]);
    expect(pts.map((p) => p.exam)).toEqual([60, 80, 100]);
    expect(pts.map((p) => p.homework)).toEqual([100, 90, null]);
    expect(pts.find((p) => p.isCurrent)?.date).toBe("2026-07-07");
  });
  it("limit으로 최근 N개만", () => {
    const many: TrendReportRow[] = Array.from({ length: 15 }, (_, i) => ({
      id: `r${i}`,
      date: `2026-07-${String(i + 1).padStart(2, "0")}`,
      examInfo: "5/5",
      homeworkScore: null,
    }));
    expect(buildTrendPoints(many, "r14", 10)).toHaveLength(10);
  });
});

describe("hasTrend", () => {
  const pts = buildTrendPoints(
    [
      { id: "a", date: "2026-07-01", examInfo: "3/5", homeworkScore: "100%" },
      { id: "b", date: "2026-07-05", examInfo: "4/5", homeworkScore: null },
    ],
    "b",
  );
  it("지표별 유효 점 2개 이상이면 true", () => {
    expect(hasTrend(pts, "exam")).toBe(true); // 2점
    expect(hasTrend(pts, "homework")).toBe(false); // 1점
  });
});
