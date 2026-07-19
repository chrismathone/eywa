import { describe, it, expect } from "vitest";
import {
  isHexColor,
  hexToRgba,
  brandColorVars,
  DEFAULT_BRAND_COLOR,
} from "./color-utils";

describe("isHexColor", () => {
  it("accepts #RRGGBB and #RGB (any case)", () => {
    expect(isHexColor("#1a5f3c")).toBe(true);
    expect(isHexColor("#ABC")).toBe(true);
    expect(isHexColor("  #fff  ")).toBe(true);
  });
  it("rejects malformed values", () => {
    expect(isHexColor("#1a5f3")).toBe(false); // 5 digits
    expect(isHexColor("1a5f3c")).toBe(false); // no #
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor("")).toBe(false);
  });
});

describe("hexToRgba", () => {
  it("converts 6-digit hex", () => {
    expect(hexToRgba("#1a5f3c", 0.1)).toBe("rgba(26, 95, 60, 0.1)");
  });
  it("expands 3-digit hex", () => {
    expect(hexToRgba("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });
  it("returns empty string for invalid hex", () => {
    expect(hexToRgba("nope", 0.5)).toBe("");
  });
});

describe("brandColorVars", () => {
  it("returns null for default color (no override needed)", () => {
    expect(brandColorVars(DEFAULT_BRAND_COLOR)).toBeNull();
    expect(brandColorVars("#0E7C46")).toBeNull(); // case-insensitive
  });
  it("returns null for legacy default forest green (저장된 옛 기본값이 리스킨을 덮지 않게)", () => {
    expect(brandColorVars("#1a5f3c")).toBeNull();
    expect(brandColorVars("#1A5F3C")).toBeNull();
  });
  it("returns null for empty/invalid input", () => {
    expect(brandColorVars("")).toBeNull();
    expect(brandColorVars(undefined)).toBeNull();
    expect(brandColorVars("#zzz")).toBeNull();
  });
  it("maps primary + derived tokens for a custom color", () => {
    const vars = brandColorVars("#1f6ba8") as Record<string, string>;
    expect(vars["--primary"]).toBe("#1f6ba8");
    expect(vars["--primary-soft"]).toBe("rgba(31, 107, 168, 0.1)");
    expect(vars["--primary-softer"]).toBe("rgba(31, 107, 168, 0.05)");
    expect(vars["--ring"]).toBe("#1f6ba8");
    expect(vars["--chart-2"]).toBe("#1f6ba8");
    expect(vars["--sidebar-primary"]).toBe("#1f6ba8");
  });
});
