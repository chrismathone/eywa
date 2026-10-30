import { describe, expect, it } from "vitest";
import { correlationWord, courseRevenueMonths, courseRevenueSummary, pearson, slope } from "./course-revenue";
import type { HistoryMonth } from "./history";

const m = (month: string, students: number, math: number, eng: number, o: Partial<HistoryMonth> = {}): HistoryMonth =>
  ({ month, estimated: [], payingTotal: students, payingMath: math, payingEnglish: eng, ...o });

describe("과목 수와 매출(원장 2026-10-30)", () => {
  it("상관계수 · 기울기 기본", () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [6, 4, 2])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();
    expect(pearson([1, 2], [1, 2])).toBeNull();
    expect(slope([1, 2, 3], [10, 20, 30])).toBeCloseTo(10);
    expect(correlationWord(0.82)).toBe("강한 양의 상관");
    expect(correlationWord(-0.5)).toBe("뚜렷한 음의 상관");
    expect(correlationWord(0.1)).toBe("상관 거의 없음");
  });

  it("달마다 학생당 강좌·수업료 · 과목을 셀 수 없는 달·돈 없는 달은 빠진다 · 청구 방식이 바뀐 달과 튀는 달은 표시하고 분석에서 뺀다", () => {
    const months = [
      m("2024-01", 100, 60, 60), m("2024-02", 100, 62, 60), m("2024-03", 100, 64, 60), m("2024-04", 100, 66, 60),
      m("2024-05", 100, 68, 60, { bridged: true }),
      m("2024-06", 100, 70, 60),
      { month: "2024-07", estimated: [], payingTotal: 100, payingMath: 70 } as HistoryMonth, // 영어 칸 없음 → 셀 수 없음
      m("2024-08", 100, 72, 60),
    ];
    const tuition = [
      { month: "2024-01", general: 30_000_000, source: "makeedu" as const }, { month: "2024-02", general: 30_400_000, source: "makeedu" as const },
      { month: "2024-03", general: 60_000_000, source: "makeedu" as const }, // 두 달치 몰림 → 튀는 달
      { month: "2024-04", general: 31_200_000, source: "makeedu" as const }, { month: "2024-05", general: 31_600_000, source: "makeedu" as const },
      { month: "2024-06", general: 31_000_000, eie: 1_000_000, source: "makeedu" as const }, { month: "2024-07", general: 32_400_000, source: "makeedu" as const },
      { month: "2024-08", general: 32_800_000, source: "makeedu" as const },
    ];
    const rows = courseRevenueMonths(months, tuition, ["math", "english"]);
    expect(rows.map((r) => [r.month, r.excluded ?? null])).toEqual([
      ["2024-01", null], ["2024-02", null], ["2024-03", "outlier"], ["2024-04", null], ["2024-05", "billing-change"], ["2024-06", null], ["2024-08", null],
    ]);
    expect(rows[0]).toMatchObject({ students: 100, courses: 120, revenue: 30_000_000, coursesPerStudent: 1.2, revenuePerStudent: 300_000 });
    const s = courseRevenueSummary(rows);
    expect(s).toMatchObject({ months: 5, from: "2024-01", to: "2024-08", excluded: ["2024-03", "2024-05"] });
    expect(s.perStudent.r!).toBeGreaterThan(0.95);
    // 학생당 강좌 0.02개마다 학생당 약 4,000원 → 0.1개당 약 2만 원(6월은 EiE 몫이 더해져 직선에서 조금 벗어난다)
    expect(s.perStudent.per01!).toBeGreaterThan(18_000);
    expect(s.perStudent.per01!).toBeLessThan(25_000);
    expect(s.yearly).toHaveLength(1);
    // 진행 중인 달(before부터)은 뺀다.
    expect(courseRevenueMonths(months, tuition, ["math", "english"], "2024-08").map((r) => r.month)).not.toContain("2024-08");
  });
});
