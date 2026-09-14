import { describe, expect, it } from "vitest";
import { addDays, diffDays, formatDotDate, formatMdW, quarterOf, weekIndexOf, weekdayOf, weeksOfMonth } from "./calendar";

describe("progress-map calendar", () => {
  it("요일은 UTC 자정 기준 — 2026-09-16은 수요일, 2026-01-01은 목요일", () => {
    expect(weekdayOf("2026-09-16")).toBe(3);
    expect(weekdayOf("2026-01-01")).toBe(4);
    expect(formatMdW("2026-09-16")).toBe("9/16 (수)");
  });

  it("주는 월요일 시작·달 안으로 자른다 — 2026년 9월은 5주(1일 화요일)", () => {
    const weeks = weeksOfMonth(2026, 9);
    expect(weeks.map((w) => [w.start, w.end, w.days.length])).toEqual([
      ["2026-09-01", "2026-09-06", 6],
      ["2026-09-07", "2026-09-13", 7],
      ["2026-09-14", "2026-09-20", 7],
      ["2026-09-21", "2026-09-27", 7],
      ["2026-09-28", "2026-09-30", 3],
    ]);
    expect(weekIndexOf("2026-09-16")).toBe(3);
    expect(weekIndexOf("2026-09-30")).toBe(5);
  });

  it("1일이 월요일이면 첫 주가 꽉 찬다 — 2026년 6월", () => {
    const weeks = weeksOfMonth(2026, 6);
    expect(weeks[0]).toMatchObject({ start: "2026-06-01", end: "2026-06-07" });
    expect(weeks.length).toBe(5);
  });

  it("날짜 산술", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(diffDays("2026-08-20", "2026-12-18")).toBe(120);
    expect(quarterOf(9)).toBe(3);
    expect(formatDotDate("2026-09-16")).toBe("2026. 9. 16.");
  });
});
