import { describe, it, expect } from "vitest";
import {
  isHexColor,
  hexToRgba,
  brandColorVars,
  isBrandColorApplied,
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
    expect(brandColorVars("#153E75")).toBeNull(); // case-insensitive
  });
  it("returns null for legacy defaults (저장된 옛 기본값이 리스킨을 덮지 않게)", () => {
    expect(brandColorVars("#1a5f3c")).toBeNull(); // v1 forest
    expect(brandColorVars("#1A5F3C")).toBeNull();
    expect(brandColorVars("#0e7c46")).toBeNull(); // v2 pine
    expect(brandColorVars("#0E7C46")).toBeNull();
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

describe("isBrandColorApplied", () => {
  // /owner 브랜드색 안내문의 분기 전제를 고정한다. 기본색은 "주입 생략"이지만 그건 **정상 상태**라
  // 화면(profile-section)이 "적용되지 않습니다" 경고 대신 "기본 팔레트와 같은 색"으로 안내해야 한다 —
  // 둘을 한 조건으로 묶으면 저장값이 네이비인데 문제로 보이는 오해가 생긴다(2026-07-20).
  it("false for default color — 어긋남이 아니라 '기본색과 동일'(문구 분기용)", () => {
    expect(isBrandColorApplied(DEFAULT_BRAND_COLOR)).toBe(false);
    expect(isBrandColorApplied("#153E75")).toBe(false);
  });
  it("false for legacy defaults / invalid / empty — 진짜 '적용 안 됨'", () => {
    expect(isBrandColorApplied("#1a5f3c")).toBe(false);
    expect(isBrandColorApplied("#0e7c46")).toBe(false);
    expect(isBrandColorApplied("#zzz")).toBe(false);
    expect(isBrandColorApplied("")).toBe(false);
    expect(isBrandColorApplied(undefined)).toBe(false);
    // 이중 인코딩된 값(실제로 밟은 함정: jsonb에 `"#153e75"`가 통째 저장) — hex 검증 실패로 미적용.
    expect(isBrandColorApplied('"#153e75"')).toBe(false);
  });
  it("true for a real custom brand color", () => {
    expect(isBrandColorApplied("#1f6ba8")).toBe(true);
  });
});
