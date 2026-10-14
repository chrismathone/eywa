import { describe, expect, it } from "vitest";
import { EARLY_SPANS, earlyCounts, isEarlyWithin, parseEarly, tenureDays } from "./early-exit";

describe("등록 후 조기 퇴원 — 등록일부터 며칠 만인가", () => {
  it("일수 = 퇴원일 − 등록일(같은 날 0)", () => {
    expect(tenureDays("2026-09-01", "2026-09-01")).toBe(0);
    expect(tenureDays("2026-09-01", "2026-10-01")).toBe(30);
    expect(tenureDays("2026-02-27", "2026-03-01")).toBe(2);
  });

  it("판정 못 하는 기록은 null — 비었거나 · 모양이 틀리거나 · 퇴원일이 등록일보다 앞선다", () => {
    expect(tenureDays(null, "2026-09-01")).toBeNull();
    expect(tenureDays("2026-09-01", null)).toBeNull();
    expect(tenureDays("2026-9-1", "2026-10-01")).toBeNull();
    expect(tenureDays("2026-07-20", "2026-07-13")).toBeNull();
  });

  it("1·2·3개월 = 30·60·90일, 양끝 포함 · 누적", () => {
    expect(EARLY_SPANS.map((s) => s.days)).toEqual([30, 60, 90]);
    expect(isEarlyWithin(30, "1m")).toBe(true);
    expect(isEarlyWithin(31, "1m")).toBe(false);
    expect(isEarlyWithin(31, "2m")).toBe(true);
    expect(isEarlyWithin(90, "3m")).toBe(true);
    expect(isEarlyWithin(91, "3m")).toBe(false);
    expect(isEarlyWithin(null, "3m")).toBe(false);
    expect(earlyCounts([{ days: 0 }, { days: 30 }, { days: 45 }, { days: 90 }, { days: 120 }, { days: null }])).toEqual({
      "1m": 2,
      "2m": 3,
      "3m": 4,
    });
  });

  it("주소 값은 세 가지만", () => {
    expect(parseEarly("1m")).toBe("1m");
    expect(parseEarly("3m")).toBe("3m");
    expect(parseEarly("4m")).toBeNull();
    expect(parseEarly(undefined)).toBeNull();
  });
});
