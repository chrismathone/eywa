import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_PREFS,
  isSubjectFilterActive,
  matchesSubjectFilter,
  parseLiveViewPrefs,
  parseSubjectFilter,
  resolveSubjectFilter,
  SUBJECT_FILTER_ALL,
} from "./view-prefs";

describe("parseLiveViewPrefs", () => {
  it("저장된 적 없으면 전체", () => {
    expect(parseLiveViewPrefs(undefined)).toEqual(DEFAULT_LIVE_PREFS);
    expect(parseLiveViewPrefs(null)).toEqual({ subject: SUBJECT_FILTER_ALL });
    expect(parseLiveViewPrefs("망가진 값")).toEqual({ subject: SUBJECT_FILTER_ALL });
    expect(parseLiveViewPrefs([])).toEqual({ subject: SUBJECT_FILTER_ALL });
  });

  it("저장된 과목 키를 그대로 읽는다", () => {
    expect(parseLiveViewPrefs({ subject: "math" })).toEqual({ subject: "math" });
  });

  it("모양이 이상한 값은 버린다(설정 한 줄이 화면을 깨뜨리지 않게)", () => {
    expect(parseSubjectFilter(42)).toBe(SUBJECT_FILTER_ALL);
    expect(parseSubjectFilter("")).toBe(SUBJECT_FILTER_ALL);
    expect(parseSubjectFilter("x".repeat(65))).toBe(SUBJECT_FILTER_ALL);
    expect(parseSubjectFilter("x".repeat(64))).toBe("x".repeat(64));
  });

  it("형제 필드가 있어도 subject만 흡수한다(필드별 독립)", () => {
    expect(parseLiveViewPrefs({ subject: "english", 낯선키: 1 })).toEqual({ subject: "english" });
  });
});

describe("resolveSubjectFilter", () => {
  const filters = [{ value: "all" }, { value: "math" }, { value: "english" }];

  it("설정에 있는 과목이면 그대로", () => {
    expect(resolveSubjectFilter("math", filters)).toBe("math");
  });

  it("🔴 설정에서 사라진 과목이면 전체로 되돌린다 — 빈 화면은 '출결이 사라졌다'로 읽힌다", () => {
    expect(resolveSubjectFilter("arts", filters)).toBe(SUBJECT_FILTER_ALL);
    expect(resolveSubjectFilter("math", [{ value: "all" }])).toBe(SUBJECT_FILTER_ALL);
  });

  it("전체는 언제나 전체", () => {
    expect(resolveSubjectFilter(SUBJECT_FILTER_ALL, [])).toBe(SUBJECT_FILTER_ALL);
  });
});

describe("matchesSubjectFilter", () => {
  it("🔴 전체면 항상 참 — 필터가 없을 때 아무 줄도 안 그리는 사고를 구조로 막는다", () => {
    expect(matchesSubjectFilter(SUBJECT_FILTER_ALL, "math")).toBe(true);
    expect(matchesSubjectFilter(SUBJECT_FILTER_ALL, null)).toBe(true);
    expect(matchesSubjectFilter(SUBJECT_FILTER_ALL, "")).toBe(true);
  });

  it("같은 과목만 통과", () => {
    expect(matchesSubjectFilter("math", "math")).toBe(true);
    expect(matchesSubjectFilter("math", "english")).toBe(false);
  });

  it("과목이 없는 반(미분류)은 특정 과목 필터에서 빠진다", () => {
    expect(matchesSubjectFilter("math", null)).toBe(false);
    expect(matchesSubjectFilter("math", "")).toBe(false);
  });
});

describe("isSubjectFilterActive", () => {
  it("전체가 아니면 걸린 것", () => {
    expect(isSubjectFilterActive(SUBJECT_FILTER_ALL)).toBe(false);
    expect(isSubjectFilterActive("math")).toBe(true);
  });
});
