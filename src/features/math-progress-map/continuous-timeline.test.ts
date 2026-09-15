import { describe, expect, it } from "vitest";
import { monthPosition, periodAt, rollingPeriods, turnDelta } from "./continuous-timeline";

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
});
