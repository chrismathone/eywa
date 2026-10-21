import { describe, expect, it } from "vitest";
import { DEFAULT_SHUTTLE_TODAY_PREFS, parseShuttleTodayPrefs } from "./today-prefs";

/**
 * 저장된 보기 설정은 **믿지 않고 파싱한다** — jsonb라 무엇이든 들어올 수 있고, 모르는 값이 그대로
 * 화면 필터가 되면 목록이 통째로 빈다(그건 "그날 아무도 안 탄다"로 보인다).
 */
describe("parseShuttleTodayPrefs", () => {
  it("저장된 호차 칸 키를 그대로 돌려준다", () => {
    expect(parseShuttleTodayPrefs({ vehicle: "name:2호차" })).toEqual({ vehicle: "name:2호차" });
    expect(parseShuttleTodayPrefs({ vehicle: "id:abc" })).toEqual({ vehicle: "id:abc" });
  });

  it("🔴 옛 등하원 보기(direction)는 버린다 — 걸린 채 열리면 이유 없이 회차가 빠진다", () => {
    expect(parseShuttleTodayPrefs({ direction: "in" })).toEqual(DEFAULT_SHUTTLE_TODAY_PREFS);
    expect(parseShuttleTodayPrefs({ direction: "out", vehicle: "name:1호차" })).toEqual({ vehicle: "name:1호차" });
  });

  it("🔴 모르는 값·빠진 키·엉뚱한 타입은 기본값으로 접는다", () => {
    for (const bad of [undefined, null, {}, [], "in", 3, { vehicle: "2호차" }, { vehicle: null }, { vehicle: `name:${"x".repeat(81)}` }]) {
      expect(parseShuttleTodayPrefs(bad)).toEqual(DEFAULT_SHUTTLE_TODAY_PREFS);
    }
  });

  it("기본값은 '전체' — 아무것도 숨기지 않은 상태로 연다", () => {
    expect(DEFAULT_SHUTTLE_TODAY_PREFS).toEqual({ vehicle: null });
  });
});
