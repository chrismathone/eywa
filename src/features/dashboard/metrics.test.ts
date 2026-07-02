import { describe, it, expect } from "vitest";
import { enrollmentDelta, trendDelta } from "./metrics";

describe("enrollmentDelta", () => {
  it("양수", () => expect(enrollmentDelta(5, 3)).toBe(2));
  it("음수", () => expect(enrollmentDelta(2, 3)).toBe(-1));
  it("0", () => expect(enrollmentDelta(4, 4)).toBe(0));
});

describe("trendDelta", () => {
  it("상승", () => expect(trendDelta([80, 82, 85])).toBe(5));
  it("하락", () => expect(trendDelta([90, 88, 87])).toBe(-3));
  it("빈배열/단일 → 0", () => {
    expect(trendDelta([])).toBe(0);
    expect(trendDelta([90])).toBe(0);
  });
});
