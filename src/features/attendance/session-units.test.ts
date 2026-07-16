import { describe, expect, it } from "vitest";
import { effectiveUnits, formatSessionUnits, parseSessionUnits } from "./session-units";

describe("parseSessionUnits", () => {
  it("빈 입력 = 기본(1) → null 저장", () => {
    expect(parseSessionUnits("")).toEqual({ ok: true, value: null });
    expect(parseSessionUnits("  ")).toEqual({ ok: true, value: null });
    expect(parseSessionUnits(null)).toEqual({ ok: true, value: null });
    expect(parseSessionUnits(undefined)).toEqual({ ok: true, value: null });
  });

  it("1은 null로 정규화(기본 배수와 동일)", () => {
    expect(parseSessionUnits("1")).toEqual({ ok: true, value: null });
    expect(parseSessionUnits("1.0")).toEqual({ ok: true, value: null });
  });

  it("배수 입력 — 구 출석부 관행 값(1.5 / 2 / 0.5)", () => {
    expect(parseSessionUnits("1.5")).toEqual({ ok: true, value: 1.5 });
    expect(parseSessionUnits("2")).toEqual({ ok: true, value: 2 });
    expect(parseSessionUnits("0.5")).toEqual({ ok: true, value: 0.5 });
    expect(parseSessionUnits("12.5")).toEqual({ ok: true, value: 12.5 });
  });

  it("쉼표 소수점 허용(모바일 자판)", () => {
    expect(parseSessionUnits("1,5")).toEqual({ ok: true, value: 1.5 });
  });

  it("0·음수·비숫자·소수 둘째자리 거부", () => {
    expect(parseSessionUnits("0").ok).toBe(false);
    expect(parseSessionUnits("0.0").ok).toBe(false);
    expect(parseSessionUnits("-1").ok).toBe(false);
    expect(parseSessionUnits("abc").ok).toBe(false);
    expect(parseSessionUnits("1.55").ok).toBe(false);
    expect(parseSessionUnits("1.").ok).toBe(false);
    expect(parseSessionUnits(".5").ok).toBe(false);
  });

  it("상한 20 초과 거부", () => {
    expect(parseSessionUnits("20")).toEqual({ ok: true, value: 20 });
    expect(parseSessionUnits("20.5").ok).toBe(false);
    expect(parseSessionUnits("99").ok).toBe(false);
  });
});

describe("formatSessionUnits", () => {
  it("정수는 소수점 없이, 소수는 한 자리", () => {
    expect(formatSessionUnits(2)).toBe("2");
    expect(formatSessionUnits(1.5)).toBe("1.5");
    expect(formatSessionUnits(0.5)).toBe("0.5");
  });
});

describe("effectiveUnits", () => {
  it("null/undefined = 기본 1", () => {
    expect(effectiveUnits(null)).toBe(1);
    expect(effectiveUnits(undefined)).toBe(1);
    expect(effectiveUnits(1.5)).toBe(1.5);
  });
});
