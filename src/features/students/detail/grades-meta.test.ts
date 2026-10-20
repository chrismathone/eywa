import { describe, expect, it } from "vitest";
import {
  COMMENT_CATEGORY_KEYS,
  commentCategoryMeta,
  goalAchieved,
  goalAchievementRate,
  goalGap,
  isCommentCategory,
  periodOf,
  scorePct,
} from "./grades-meta";

describe("grades-meta", () => {
  it("periodOf → YYYY-MM (월 2자리 패딩)", () => {
    expect(periodOf(new Date(2026, 0, 5))).toBe("2026-01");
    expect(periodOf(new Date(2026, 11, 31))).toBe("2026-12");
  });

  it("scorePct — 만점 대비 백분율, 누락/0만점은 null", () => {
    expect(scorePct(90, 100)).toBe(90);
    expect(scorePct(45, 60)).toBe(75);
    expect(scorePct(null, 100)).toBeNull();
    expect(scorePct(50, null)).toBeNull();
    expect(scorePct(50, 0)).toBeNull();
  });

  it("goalAchieved — 실제 없으면 null, 있으면 실제>=목표", () => {
    expect(goalAchieved(80, null)).toBeNull();
    expect(goalAchieved(80, 80)).toBe(true);
    expect(goalAchieved(80, 95)).toBe(true);
    expect(goalAchieved(80, 79)).toBe(false);
  });

  it("goalGap — 실제 - 목표(없으면 null)", () => {
    expect(goalGap(80, null)).toBeNull();
    expect(goalGap(80, 92)).toBe(12);
    expect(goalGap(80, 70)).toBe(-10);
  });

  it("goalAchievementRate — 미응시(null) 제외하고 달성률", () => {
    expect(goalAchievementRate([])).toEqual({ achieved: 0, resolved: 0, pct: null });
    expect(goalAchievementRate([{ achieved: null }, { achieved: null }])).toEqual({
      achieved: 0,
      resolved: 0,
      pct: null,
    });
    expect(
      goalAchievementRate([
        { achieved: true },
        { achieved: false },
        { achieved: true },
        { achieved: null },
      ]),
    ).toEqual({ achieved: 2, resolved: 3, pct: 67 });
  });

  it("category 메타 — 키 검증 + 폴백", () => {
    expect(COMMENT_CATEGORY_KEYS).toContain("strength");
    expect(isCommentCategory("strength")).toBe(true);
    expect(isCommentCategory("bogus")).toBe(false);
    expect(commentCategoryMeta("strength").label).toBe("학습적 강점");
    expect(commentCategoryMeta("unknown")).toEqual({ label: "unknown", color: "neutral" });
  });
});
