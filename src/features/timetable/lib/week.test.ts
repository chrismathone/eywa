import { describe, it, expect } from "vitest";
import {
  mondayOf,
  thisMonday,
  addWeeks,
  shiftDays,
  getWeekReferenceDate,
  weekEndOf,
  weekLabel,
  weekRelation,
} from "./week";

describe("week — 주(週) 경계 계산", () => {
  it("mondayOf: 금요일 → 그 주 월요일", () => {
    expect(mondayOf("2026-06-26")).toBe("2026-06-22"); // 금
  });
  it("mondayOf: 월요일 → 그대로", () => {
    expect(mondayOf("2026-06-22")).toBe("2026-06-22");
  });
  it("mondayOf: 일요일 → 직전 월요일(-6)", () => {
    expect(mondayOf("2026-06-28")).toBe("2026-06-22");
  });
  it("addWeeks / shiftDays", () => {
    expect(addWeeks("2026-06-22", 1)).toBe("2026-06-29");
    expect(addWeeks("2026-06-22", -2)).toBe("2026-06-08");
    expect(shiftDays("2026-06-22", 6)).toBe("2026-06-28");
  });
  it("thisMonday", () => {
    expect(thisMonday("2026-06-26")).toBe("2026-06-22");
  });
});

describe("getWeekReferenceDate — ijw 3분기", () => {
  const today = "2026-06-26"; // 금, thisMonday=06-22
  it("이번 주 → 오늘", () => {
    expect(getWeekReferenceDate("2026-06-22", today)).toBe("2026-06-26");
  });
  it("과거 주 → 그 주 일요일", () => {
    // 06-08 주(월) → weekEnd 06-14, today 06-26 > 06-14 → 과거 → 06-14
    expect(getWeekReferenceDate("2026-06-08", today)).toBe("2026-06-14");
  });
  it("미래 주 → 그 주 월요일", () => {
    expect(getWeekReferenceDate("2026-07-06", today)).toBe("2026-07-06");
  });
  it("weekEndOf = ref+6", () => {
    expect(weekEndOf("2026-06-26")).toBe("2026-07-02");
    expect(weekEndOf("2026-06-14")).toBe("2026-06-20");
  });
});

describe("weekLabel — 주차 라벨", () => {
  it("달 안 — 2026년 6월 4주차 (22일~28일)", () => {
    expect(weekLabel("2026-06-22")).toBe("2026년 6월 4주차 (22일~28일)");
  });
  it("달 경계 — 29일~7/5일", () => {
    expect(weekLabel("2026-06-29")).toBe("2026년 6월 5주차 (29일~7/5일)");
  });
});

describe("weekRelation", () => {
  const today = "2026-06-26";
  it("현재/과거/미래", () => {
    expect(weekRelation("2026-06-22", today)).toBe("current");
    expect(weekRelation("2026-06-08", today)).toBe("past");
    expect(weekRelation("2026-07-06", today)).toBe("future");
  });
});
