import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONESCREEN_FONT_SIZE,
  ONESCREEN_FONT_SIZE_ZOOM,
  parseOnescreenFontSize,
  readOnescreenFontSize,
} from "./font-size";

describe("parseOnescreenFontSize", () => {
  it("아는 값은 그대로", () => {
    expect(parseOnescreenFontSize("md")).toBe("md");
    expect(parseOnescreenFontSize("lg")).toBe("lg");
  });
  it("모르는 값·부재는 기본값 '작음'(지금 화면 그대로)", () => {
    for (const bad of [undefined, null, "", "huge", 3, {}]) {
      expect(parseOnescreenFontSize(bad)).toBe("sm");
    }
  });
});

describe("readOnescreenFontSize", () => {
  it("onescreen 네임스페이스 안에서 읽는다", () => {
    expect(readOnescreenFontSize({ onescreen: { fontSize: "lg" } })).toBe("lg");
  });
  it("다른 화면(timetable) 설정에 오염되지 않는다", () => {
    expect(readOnescreenFontSize({ timetable: { fontSize: "lg" } })).toBe("sm");
  });
  it("모양이 깨져 있어도 throw하지 않고 기본값", () => {
    for (const bad of [null, undefined, "x", [], { onescreen: "lg" }, { onescreen: [] }]) {
      expect(readOnescreenFontSize(bad)).toBe("sm");
    }
  });
});

describe("배율", () => {
  it("기본값은 확대 없음 — 손대지 않은 강사의 화면이 바뀌면 안 된다", () => {
    expect(ONESCREEN_FONT_SIZE_ZOOM[DEFAULT_ONESCREEN_FONT_SIZE]).toBe(1);
  });
  it("작음 < 보통 < 큼", () => {
    expect(ONESCREEN_FONT_SIZE_ZOOM.sm).toBeLessThan(ONESCREEN_FONT_SIZE_ZOOM.md);
    expect(ONESCREEN_FONT_SIZE_ZOOM.md).toBeLessThan(ONESCREEN_FONT_SIZE_ZOOM.lg);
  });
});
