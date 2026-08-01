import { describe, expect, it } from "vitest";
import {
  DEFAULT_ECS_FONT_SIZE,
  ECS_FONT_SIZE_ZOOM,
  parseEcsFontSize,
  readEcsFontSize,
} from "./font-size";

describe("ECS 글씨 크기", () => {
  it("기본은 '작음'이고 배율 1 — 손대지 않은 화면은 지금 그대로", () => {
    expect(DEFAULT_ECS_FONT_SIZE).toBe("sm");
    expect(ECS_FONT_SIZE_ZOOM[DEFAULT_ECS_FONT_SIZE]).toBe(1);
  });

  it("커질수록 배율이 커진다", () => {
    expect(ECS_FONT_SIZE_ZOOM.md).toBeGreaterThan(ECS_FONT_SIZE_ZOOM.sm);
    expect(ECS_FONT_SIZE_ZOOM.lg).toBeGreaterThan(ECS_FONT_SIZE_ZOOM.md);
  });

  it("모르는 값·null은 기본값으로 떨어진다", () => {
    expect(parseEcsFontSize("huge")).toBe("sm");
    expect(parseEcsFontSize(null)).toBe("sm");
    expect(parseEcsFontSize(2)).toBe("sm");
  });

  it("ui_prefs는 ecs 네임스페이스 안에서만 읽는다(다른 화면 설정을 훔쳐 쓰지 않는다)", () => {
    expect(readEcsFontSize({ ecs: { fontSize: "lg" } })).toBe("lg");
    expect(readEcsFontSize({ onescreen: { fontSize: "lg" } })).toBe("sm");
    expect(readEcsFontSize({ ecs: "lg" })).toBe("sm");
    expect(readEcsFontSize(null)).toBe("sm");
    expect(readEcsFontSize([{ fontSize: "lg" }])).toBe("sm");
  });
});
