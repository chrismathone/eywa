import { describe, expect, it } from "vitest";
import { fitWithin } from "./resize-image";

describe("fitWithin — 긴 변 maxEdge까지 축소, 업스케일 없음", () => {
  it("긴 변 초과 → 비율 유지 축소(가로 우세)", () => {
    expect(fitWithin(3200, 2400, 1600)).toEqual({ w: 1600, h: 1200 });
  });
  it("긴 변 초과 → 비율 유지 축소(세로 우세)", () => {
    expect(fitWithin(2000, 4000, 1600)).toEqual({ w: 800, h: 1600 });
  });
  it("정사각", () => {
    expect(fitWithin(3000, 3000, 1600)).toEqual({ w: 1600, h: 1600 });
  });
  it("이하면 그대로(업스케일 없음)", () => {
    expect(fitWithin(1200, 800, 1600)).toEqual({ w: 1200, h: 800 });
  });
  it("정확히 maxEdge → 그대로", () => {
    expect(fitWithin(1600, 900, 1600)).toEqual({ w: 1600, h: 900 });
  });
  it("반올림", () => {
    // 1000x333, maxEdge 800 → scale 0.8 → 800 x 266.4 → 266
    expect(fitWithin(1000, 333, 800)).toEqual({ w: 800, h: 266 });
  });
  it("0/음수 방어", () => {
    expect(fitWithin(0, 0, 1600)).toEqual({ w: 0, h: 0 });
    expect(fitWithin(-5, 10, 1600)).toEqual({ w: 0, h: 10 });
  });
});
