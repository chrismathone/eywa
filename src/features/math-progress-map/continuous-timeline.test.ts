import { describe, expect, it } from "vitest";
import { monthPosition, periodAt, rollingPeriods, timelineRange, timelineStops, turnDelta } from "./continuous-timeline";
import { buildSampleProgress } from "./sample";
import type { StudentProgress } from "./model";

describe("연도를 잇는 시계 좌표", () => {
  it("12월에서 양방향으로 연도를 넘나든다", () => {
    const december = monthPosition(2026, 12);
    expect(periodAt(december + 1)).toEqual({ year: 2027, month: 1 });
    expect(periodAt(monthPosition(2027, 1) - 1)).toEqual({ year: 2026, month: 12 });
    expect(periodAt(december + 24)).toEqual({ year: 2028, month: 12 });
  });

  it("항상 12칸을 유지하면서 반대편 달부터 다음 해로 교체한다", () => {
    const periods = rollingPeriods(monthPosition(2026, 12));
    expect(periods.map(p => p.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(periods[0]).toEqual({ year: 2027, month: 1 });
    expect(periods[11]).toEqual({ year: 2026, month: 12 });
    const next = rollingPeriods(monthPosition(2027, 1));
    expect(next.filter((p, index) => p.year !== periods[index]!.year)).toEqual([{ year: 2027, month: 7 }]);
  });

  it("각도 경계를 넘어 감아도 방향과 이동량을 유지한다", () => {
    expect(turnDelta(170, -170)).toBe(20);
    expect(turnDelta(-170, 170)).toBe(-20);
    expect(turnDelta(10, 40)).toBe(30);
  });

  it("실제 입학부터 마지막 계획 월까지만 시간 막대를 표시한다", () => {
    const { min, max } = timelineRange(buildSampleProgress());
    expect(periodAt(min)).toEqual({ year: 2026, month: 1 });
    expect(periodAt(max)).toEqual({ year: 2029, month: 2 });
  });

  it("수업일 배분이 비어도 저장된 수학 최종 목표 월까지 이동한다", () => {
    const sample = buildSampleProgress();
    const progress: StudentProgress = { ...sample, year: 2026,
      years: [2027, 2028].map(year => ({ year, yearPlan: [], dailyProgress: [] })),
      yearPlan: [], dailyProgress: [], roadmap: { ...sample.roadmap!, steps: [] },
      plan: { ...sample.plan, startDate: "2026-04-01", targetDate: "2028-09-30" },
      learningMap: {} as StudentProgress["learningMap"] };
    const { min, max } = timelineRange(progress);
    expect(periodAt(min)).toEqual({ year: 2026, month: 1 });
    expect(periodAt(max)).toEqual({ year: 2028, month: 9 });
  });

  it("연도 눈금은 시작·종료 월 사이의 실제 월 간격에 비례한다", () => {
    const stops = timelineStops(monthPosition(2023, 5), monthPosition(2026, 8), [2023, 2024, 2025, 2026]);
    expect(stops.map(({ year, month }) => [year, month])).toEqual([[2023, 5], [2024, 1], [2025, 1], [2026, 8]]);
    expect(stops[0]!.offset).toBe(0);
    expect(stops[1]!.offset).toBeCloseTo(8 / 39 * 100);
    expect(stops[2]!.offset).toBeCloseTo(20 / 39 * 100);
    expect(stops[3]!.offset).toBe(100);
  });

  it("자료가 있는 기간과 연도만 사용하고 한 달 범위도 처리한다", () => {
    const sample = buildSampleProgress();
    const progress = { ...sample, year: 2031, years: [], roadmap: undefined, dailyProgress: [], yearPlan: [{ ...sample.yearPlan[0]!, month: 4 }] };
    const { min, max } = timelineRange(progress);
    expect(min).toBe(monthPosition(2031, 4));
    expect(max).toBe(min);
    expect(timelineStops(min, max, [2031])).toEqual([{ year: 2031, month: 4, position: min, offset: 0 }]);
    expect(timelineStops(monthPosition(2023, 5), monthPosition(2026, 8), [2023, 2026])).toHaveLength(2);
  });
});
