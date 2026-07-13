import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  monthLabel,
  shiftMonth,
  monthRange,
  weekdayHeaders,
  buildWeekBars,
  countSpansPerDay,
  type MonthCell,
  type TaskSpan,
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

describe("buildWeekBars — 기간 막대 배치", () => {
  const week = ["2026-06-28", "2026-06-29", "2026-06-30", "2026-07-01", "2026-07-02", "2026-07-03", "2026-07-04"];

  it("단일 날짜 = span 1 막대", () => {
    const { bars, lanes } = buildWeekBars(week, [{ id: "a", start: "2026-07-01", end: "2026-07-01" }]);
    expect(lanes).toBe(1);
    expect(bars[0]).toMatchObject({ id: "a", colStart: 4, colSpan: 1, lane: 0, continuesLeft: false, continuesRight: false });
  });

  it("여러 날 기간 = colSpan이 늘고 열 계산 정확 (06-29~07-03 → 2열부터 5칸)", () => {
    const { bars } = buildWeekBars(week, [{ id: "b", start: "2026-06-29", end: "2026-07-03" }]);
    expect(bars[0]).toMatchObject({ id: "b", colStart: 2, colSpan: 5 });
  });

  it("겹치는 스팬은 다른 레인으로", () => {
    const { bars, lanes } = buildWeekBars(week, [
      { id: "a", start: "2026-06-28", end: "2026-06-30" },
      { id: "b", start: "2026-06-29", end: "2026-07-02" },
    ]);
    expect(lanes).toBe(2);
    expect(bars.find((x) => x.id === "a")!.lane).toBe(0);
    expect(bars.find((x) => x.id === "b")!.lane).toBe(1);
  });

  it("안 겹치면 같은 레인 재사용", () => {
    const { lanes } = buildWeekBars(week, [
      { id: "a", start: "2026-06-28", end: "2026-06-29" },
      { id: "b", start: "2026-07-01", end: "2026-07-02" },
    ]);
    expect(lanes).toBe(1);
  });

  it("주 경계로 잘리면 continuesLeft/Right + 열 클램프", () => {
    const { bars } = buildWeekBars(week, [{ id: "c", start: "2026-06-25", end: "2026-07-10" }]);
    expect(bars[0]).toMatchObject({ colStart: 1, colSpan: 7, continuesLeft: true, continuesRight: true });
  });

  it("주 밖 스팬은 제외", () => {
    const { bars } = buildWeekBars(week, [{ id: "z", start: "2026-08-01", end: "2026-08-03" }]);
    expect(bars).toHaveLength(0);
  });
});

describe("countSpansPerDay", () => {
  const week = ["2026-07-05", "2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10", "2026-07-11"];
  it("각 날짜에 걸치는 스팬 수를 센다", () => {
    const spans: TaskSpan[] = [
      { id: "a", start: "2026-07-06", end: "2026-07-08" },
      { id: "b", start: "2026-07-07", end: "2026-07-07" },
    ];
    const c = countSpansPerDay(week, spans);
    expect(c["2026-07-05"]).toBe(0);
    expect(c["2026-07-06"]).toBe(1);
    expect(c["2026-07-07"]).toBe(2);
    expect(c["2026-07-08"]).toBe(1);
  });
});
