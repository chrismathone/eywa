import { describe, it, expect } from "vitest";
import {
  sortDaysInGroup,
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
  it("mon-tue-seq = 월화/수목/금", () => {
    expect(weekdayPartition("mon-tue-seq")).toEqual([["mon", "tue"], ["wed", "thu"], ["fri"]]);
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

describe("sortDaysInGroup", () => {
  it("프리셋에 적힌 순서를 따른다 — 화·목은 화요일이 먼저", () => {
    expect(sortDaysInGroup(["thu", "tue"], ["tue", "thu"])).toEqual(["tue", "thu"]);
    expect(sortDaysInGroup(["wed", "mon"], ["mon", "wed", "fri"])).toEqual(["mon", "wed"]);
    expect(sortDaysInGroup(["thu", "mon"], ["mon", "thu"])).toEqual(["mon", "thu"]);
    expect(sortDaysInGroup(["fri", "tue"], ["tue", "fri"])).toEqual(["tue", "fri"]);
  });
});

describe("WEEKDAY_GROUPING_OPTIONS", () => {
  it("프리셋마다 라벨이 있다", () => {
    expect(WEEKDAY_GROUPING_OPTIONS).toHaveLength(WEEKDAY_GROUPINGS.length);
    expect(WEEKDAY_GROUPING_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
