import { describe, expect, it } from "vitest";
import { FULL_CROP, MIN_CROP, cropPixels, dragCrop, isFullCrop, type CropRect } from "./crop-math";

function near(got: CropRect, want: CropRect) {
  for (const k of ["x", "y", "w", "h"] as const) expect(got[k]).toBeCloseTo(want[k], 6);
}

describe("dragCrop", () => {
  const MID: CropRect = { x: 0.2, y: 0.2, w: 0.5, h: 0.5 };

  it("가운데를 끌면 크기 그대로 옮기고 그림 밖으로 안 나간다", () => {
    near(dragCrop(MID, "move", 0.1, -0.05), { x: 0.3, y: 0.15, w: 0.5, h: 0.5 });
    near(dragCrop(MID, "move", 1, 1), { x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    near(dragCrop(MID, "move", -1, -1), { x: 0, y: 0, w: 0.5, h: 0.5 });
  });

  it("모서리는 맞은편 모서리를 붙잡고 늘이고 줄인다", () => {
    near(dragCrop(FULL_CROP, "se", -0.3, -0.4), { x: 0, y: 0, w: 0.7, h: 0.6 });
    near(dragCrop(MID, "ne", 0.9, -0.9), { x: 0.2, y: 0, w: 0.8, h: 0.7 });
    near(dragCrop(MID, "sw", -0.1, 0.1), { x: 0.1, y: 0.2, w: 0.6, h: 0.6 });
  });

  it("최소 크기 아래로는 안 줄어든다", () => {
    near(dragCrop(FULL_CROP, "nw", 0.99, 0.99), { x: 1 - MIN_CROP, y: 1 - MIN_CROP, w: MIN_CROP, h: MIN_CROP });
    near(dragCrop(MID, "se", -0.9, -0.9), { x: 0.2, y: 0.2, w: MIN_CROP, h: MIN_CROP });
  });

  it("숫자가 아닌 거리(NaN)는 움직이지 않은 것으로", () => {
    near(dragCrop(MID, "move", Number.NaN, Number.NaN), MID);
  });
});

describe("isFullCrop · cropPixels", () => {
  it("전체면 자르지 않는다", () => {
    expect(isFullCrop(FULL_CROP)).toBe(true);
    expect(isFullCrop({ x: 0.001, y: 0, w: 0.999, h: 1 })).toBe(true);
    expect(isFullCrop({ x: 0, y: 0, w: 0.9, h: 1 })).toBe(false);
  });

  it("원본 픽셀 — 반올림해도 그림 안 · 최소 1px", () => {
    expect(cropPixels({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }, { w: 1000, h: 800 })).toEqual({ sx: 250, sy: 400, sw: 500, sh: 400 });
    expect(cropPixels({ x: 0.999, y: 0.999, w: 0.0001, h: 0.0001 }, { w: 10, h: 10 })).toEqual({ sx: 9, sy: 9, sw: 1, sh: 1 });
    expect(cropPixels(FULL_CROP, { w: 1600, h: 1200 })).toEqual({ sx: 0, sy: 0, sw: 1600, sh: 1200 });
  });
});
