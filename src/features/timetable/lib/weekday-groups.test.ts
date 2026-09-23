import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { operationsSchema } from "@/features/owner/settings-types";
import {
  completeWeekdayPartition,
  formatWeekdayGroups,
  parseWeekdayPartition,
} from "./weekday-partition";
import {
  builtinIdForGroups,
  resolveWeekdayGroups,
  sortDaysInGroup,
  weekdayGroupingChoices,
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

describe("만든 요일 병합", () => {
  const custom = completeWeekdayPartition([
    ["mon", "wed"],
    ["tue", "thu"],
  ]);

  it("월·수 / 화·목이면 금요일은 혼자 남는다", () => {
    expect(custom).toEqual([
      ["mon", "wed"],
      ["tue", "thu"],
      ["fri"],
    ]);
    expect(formatWeekdayGroups(custom!)).toBe("월·수 / 화·목 / 금");
    expect(builtinIdForGroups(custom!)).toBeNull();
  });

  it("기본 묶음과 같으면 그 프리셋으로 알아본다", () => {
    expect(builtinIdForGroups([["mon", "thu"], ["tue", "fri"], ["wed"]])).toBe("mon-thu");
  });

  it("만든 id는 그 분할로 풀리고, 없는 id는 월·목 / 화·금이다", () => {
    const groups = resolveWeekdayGroups("c_abcdef0123", [{ id: "c_abcdef0123", groups: custom! }]);
    expect(groups).toEqual(custom);
    expect(resolveWeekdayGroups("c_missing", [])).toEqual(weekdayPartition("mon-thu"));
    expect(resolveWeekdayGroups("mon-wed-fri", [])).toEqual(weekdayPartition("mon-wed-fri"));
  });

  it("드롭다운은 기본 목록 뒤에 만든 묶음을 붙인다", () => {
    const choices = weekdayGroupingChoices([{ id: "c_abcdef0123", groups: custom! }]);
    expect(choices.at(-1)).toEqual({ value: "c_abcdef0123", label: "월·수 / 화·목 / 금" });
    expect(choices.some((choice) => choice.value === "mon-thu")).toBe(true);
  });

  it("깨진 분할은 받아들이지 않는다", () => {
    expect(parseWeekdayPartition([["mon", "mon"], ["tue"], ["wed"], ["thu"], ["fri"]])).toBeNull();
    expect(parseWeekdayPartition([["mon", "tue"]])).toBeNull();
  });

  it("설정 스키마는 빈 목록과 만든 묶음을 통과시킨다", () => {
    expect(operationsSchema.safeParse(DEFAULT_SETTINGS.operations).success).toBe(true);
    const withCustom = {
      ...DEFAULT_SETTINGS.operations,
      weekdayGroupings: [{ id: "c_abcdef0123", groups: custom }],
      subjects: DEFAULT_SETTINGS.operations.subjects.map((subject, index) =>
        index === 0 ? { ...subject, weekdayGrouping: "c_abcdef0123" } : subject,
      ),
    };
    expect(operationsSchema.safeParse(withCustom).success).toBe(true);
    expect(
      operationsSchema.safeParse({
        ...DEFAULT_SETTINGS.operations,
        subjects: DEFAULT_SETTINGS.operations.subjects.map((subject, index) =>
          index === 0 ? { ...subject, weekdayGrouping: "c_missing1" } : subject,
        ),
      }).success,
    ).toBe(false);
  });
});

describe("WEEKDAY_GROUPING_OPTIONS", () => {
  it("프리셋마다 라벨이 있다", () => {
    expect(WEEKDAY_GROUPING_OPTIONS).toHaveLength(WEEKDAY_GROUPINGS.length);
    expect(WEEKDAY_GROUPING_OPTIONS.every((o) => o.label.length > 0)).toBe(true);
  });
});
