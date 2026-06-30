import { describe, it, expect } from "vitest";
import { audienceMatchesRole } from "./audience";
import { isHidden } from "./popup-store";

describe("audienceMatchesRole", () => {
  it("all → 모든 역할에 노출", () => {
    for (const r of ["master", "teacher", "student", "accountant", "counselor", "viewer"] as const) {
      expect(audienceMatchesRole("all", r)).toBe(true);
    }
  });

  it("staff → 학생만 제외", () => {
    expect(audienceMatchesRole("staff", "teacher")).toBe(true);
    expect(audienceMatchesRole("staff", "master")).toBe(true);
    expect(audienceMatchesRole("staff", "viewer")).toBe(true);
    expect(audienceMatchesRole("staff", "student")).toBe(false);
  });

  it("teachers/counselors/accounting → 해당 역할만", () => {
    expect(audienceMatchesRole("teachers", "teacher")).toBe(true);
    expect(audienceMatchesRole("teachers", "master")).toBe(false);
    expect(audienceMatchesRole("counselors", "counselor")).toBe(true);
    expect(audienceMatchesRole("counselors", "teacher")).toBe(false);
    expect(audienceMatchesRole("accounting", "accountant")).toBe(true);
    expect(audienceMatchesRole("accounting", "teacher")).toBe(false);
  });

  it("알 수 없는 audience → 안전하게 전체 노출", () => {
    expect(audienceMatchesRole("weird", "teacher")).toBe(true);
  });
});

describe("isHidden (dismiss 유효성)", () => {
  const V = "2026-06-30T00:00:00Z";

  it("엔트리 없으면 보임", () => {
    expect(isHidden(undefined, V)).toBe(false);
  });

  it("forever면 숨김", () => {
    expect(isHidden({ until: "forever", v: V }, V)).toBe(true);
  });

  it("until 미래면 숨김, 과거면 보임", () => {
    expect(isHidden({ until: Date.now() + 100_000, v: V }, V)).toBe(true);
    expect(isHidden({ until: Date.now() - 100_000, v: V }, V)).toBe(false);
  });

  it("버전(updatedAt)이 바뀌면 옛 dismiss 무시 → 재노출", () => {
    expect(isHidden({ until: "forever", v: "old-version" }, V)).toBe(false);
    expect(isHidden({ until: Date.now() + 100_000, v: "old-version" }, V)).toBe(false);
  });
});
