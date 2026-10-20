import { describe, expect, it } from "vitest";
import { DEFAULT_SHUTTLE_TODAY_PREFS, parseShuttleTodayPrefs } from "./today-prefs";

/**
 * 저장된 보기 설정은 **믿지 않고 파싱한다** — jsonb라 무엇이든 들어올 수 있고, 모르는 값이 그대로
 * 화면 필터가 되면 목록이 통째로 빈다(그건 "그날 아무도 안 탄다"로 보인다).
 */
describe("parseShuttleTodayPrefs", () => {
  it("저장된 값을 그대로 돌려준다", () => {
    expect(parseShuttleTodayPrefs({ direction: "in" })).toEqual({ direction: "in" });
    expect(parseShuttleTodayPrefs({ direction: "out" })).toEqual({ direction: "out" });
    // "all"도 유효한 저장값이다 — isDirection은 in/out만 참이라 따로 받아야 한다.
    expect(parseShuttleTodayPrefs({ direction: "all" })).toEqual({ direction: "all" });
  });

  it("🔴 모르는 값·빠진 키·엉뚱한 타입은 기본값으로 접는다", () => {
    for (const bad of [undefined, null, {}, [], "in", 3, { direction: "IN" }, { direction: null }]) {
      expect(parseShuttleTodayPrefs(bad)).toEqual(DEFAULT_SHUTTLE_TODAY_PREFS);
    }
  });

  it("기본값은 '전체' — 아무것도 숨기지 않은 상태로 연다", () => {
    expect(DEFAULT_SHUTTLE_TODAY_PREFS).toEqual({ direction: "all" });
  });
});
