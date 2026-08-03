import { describe, expect, it } from "vitest";
import { DEFAULT_ECS_SHOW_SPECIAL_ROOMS, readEcsShowSpecialRooms } from "./view-prefs";

describe("readEcsShowSpecialRooms", () => {
  it("기본은 표시 — 원장 2026-08-03 'LAB과 JJ 오픈시켜'(숨김으로 되돌리지 말 것)", () => {
    expect(DEFAULT_ECS_SHOW_SPECIAL_ROOMS).toBe(true);
    expect(readEcsShowSpecialRooms(undefined)).toBe(true);
    expect(readEcsShowSpecialRooms({})).toBe(true);
    expect(readEcsShowSpecialRooms({ ecs: {} })).toBe(true);
  });

  it("저장된 false만 숨김", () => {
    expect(readEcsShowSpecialRooms({ ecs: { showSpecialRooms: false } })).toBe(false);
    expect(readEcsShowSpecialRooms({ ecs: { showSpecialRooms: true } })).toBe(true);
  });

  it("다른 화면 네임스페이스 값은 훔쳐 읽지 않는다", () => {
    expect(readEcsShowSpecialRooms({ onescreen: { showSpecialRooms: false } })).toBe(true);
  });

  it("깨진 값(문자열·배열·null)은 기본값 — 교시가 통째로 사라지지 않게", () => {
    expect(readEcsShowSpecialRooms({ ecs: { showSpecialRooms: "false" } })).toBe(true);
    expect(readEcsShowSpecialRooms({ ecs: null })).toBe(true);
    expect(readEcsShowSpecialRooms({ ecs: [] })).toBe(true);
    expect(readEcsShowSpecialRooms([])).toBe(true);
    expect(readEcsShowSpecialRooms("nope")).toBe(true);
  });
});
