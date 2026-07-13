import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  monthLabel,
  shiftMonth,
  monthRange,
  weekdayHeaders,
  type MonthCell,
} from "./month-grid";

const flat = (weeks: MonthCell[][]) => weeks.flat();
const consecutive = (weeks: MonthCell[][]) => {
  const cells = flat(weeks);
  for (let i = 1; i < cells.length; i++) {
    const prev = new Date(`${cells[i - 1]!.date}T00:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() + 1);
    if (prev.toISOString().slice(0, 10) !== cells[i]!.date) return false;
  }
  return true;
};

describe("buildMonthGrid — 일요일 시작(기본)", () => {
  it("2026-07: 1일=수요일(dow3) → 앞 빈칸 3칸, 6/28(일)부터 시작", () => {
    const weeks = buildMonthGrid("2026-07");
    expect(weeks).toHaveLength(5); // lead 3 + 31일 = 34 → 5주
    expect(flat(weeks)).toHaveLength(35);
    expect(weeks[0]![0]!.date).toBe("2026-06-28");
    expect(weeks[0]![0]!.dow).toBe(0); // 첫 칸 = 일요일
    const jul1 = flat(weeks).find((c) => c.date === "2026-07-01")!;
    expect(jul1).toMatchObject({ day: 1, inMonth: true, dow: 3 });
  });

  it("이번 달 칸 수 = 그 달 일수, 모든 주는 7칸, 날짜는 연속", () => {
    const weeks = buildMonthGrid("2026-07");
    expect(flat(weeks).filter((c) => c.inMonth)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks.every((w) => w[0]!.dow === 0)).toBe(true);
    expect(consecutive(weeks)).toBe(true);
  });

  it("2026-02: 1일=일요일 → 앞 빈칸 0, 28일 정확히 4주", () => {
    const weeks = buildMonthGrid("2026-02");
    expect(weeks).toHaveLength(4);
    expect(weeks[0]![0]!.date).toBe("2026-02-01");
    expect(flat(weeks).filter((c) => c.inMonth)).toHaveLength(28);
  });
});

describe("buildMonthGrid — 월요일 시작", () => {
  it("2026-07: 월요일 시작이면 6/29(월)부터, 첫 칸 dow=1", () => {
    const weeks = buildMonthGrid("2026-07", { weekStartsOn: 1 });
    expect(weeks[0]![0]!.date).toBe("2026-06-29");
    expect(weeks[0]![0]!.dow).toBe(1);
    expect(flat(weeks).find((c) => c.date === "2026-07-01")).toBeDefined();
  });
});

describe("monthLabel / shiftMonth / monthRange / weekdayHeaders", () => {
  it("monthLabel", () => {
    expect(monthLabel("2026-07")).toBe("2026년 7월");
    expect(monthLabel("2026-12")).toBe("2026년 12월");
  });
  it("shiftMonth는 연 경계를 넘는다", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-07", 0)).toBe("2026-07");
  });
  it("monthRange는 [1일, 다음달 1일)", () => {
    expect(monthRange("2026-07")).toEqual({ start: "2026-07-01", endExclusive: "2026-08-01" });
    expect(monthRange("2026-12").endExclusive).toBe("2027-01-01");
  });
  it("weekdayHeaders", () => {
    expect(weekdayHeaders()).toEqual(["일", "월", "화", "수", "목", "금", "토"]);
    expect(weekdayHeaders(1)[0]).toBe("월");
    expect(weekdayHeaders(1)[6]).toBe("일");
  });
});
