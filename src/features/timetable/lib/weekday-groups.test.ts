import { describe, it, expect } from "vitest";
import {
  weekdayPartition,
  normalizeWeekdayGrouping,
  WEEKDAY_GROUPING_OPTIONS,
  WEEKDAY_GROUPINGS,
} from "./weekday-groups";

describe("weekdayPartition", () => {
  it("mon-thu = 월목/화금/수(단독)", () => {
    expect(weekdayPartition("mon-thu")).toEqual([["mon", "thu"], ["tue", "fri"], ["wed"]]);
  });
  it("mon-tue = 월화/목금/수(단독)", () => {
    expect(weekdayPartition("mon-tue")).toEqual([["mon", "tue"], ["thu", "fri"], ["wed"]]);
  });
  it("mon-wed-fri = 월수금/화목", () => {
    expect(weekdayPartition("mon-wed-fri")).toEqual([["mon", "wed", "fri"], ["tue", "thu"]]);
  });
  it("none = 요일별 개별(전부 단독)", () => {
    expect(weekdayPartition("none")).toEqual([["mon"], ["tue"], ["wed"], ["thu"], ["fri"]]);
    expect(weekdayPartition("none").every((g) => g.length === 1)).toBe(true);
  });
  it("모든 프리셋이 월~금을 정확히 1번씩 덮는다(누락·중복 없음)", () => {
    for (const g of WEEKDAY_GROUPINGS) {
      const flat = weekdayPartition(g).flat().sort();
      expect(flat).toEqual(["fri", "mon", "thu", "tue", "wed"]);
    }
  });
});

describe("normalizeWeekdayGrouping", () => {
  it("유효 프리셋은 그대로", () => {
    expect(normalizeWeekdayGrouping("mon-tue")).toBe("mon-tue");
    expect(normalizeWeekdayGrouping("none")).toBe("none");
  });
  it("미설정/불량값은 mon-thu 폴백", () => {
    expect(normalizeWeekdayGrouping(undefined)).toBe("mon-thu");
    expect(normalizeWeekdayGrouping(null)).toBe("mon-thu");
    expect(normalizeWeekdayGrouping("garbage")).toBe("mon-thu");
    expect(normalizeWeekdayGrouping(123)).toBe("mon-thu");
  });
});

describe("WEEKDAY_GROUPING_OPTIONS", () => {
  it("프리셋 4개 모두 라벨 제공", () => {
    expect(WEEKDAY_GROUPING_OPTIONS).toHaveLength(4);
    expect(WEEKDAY_GROUPING_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
