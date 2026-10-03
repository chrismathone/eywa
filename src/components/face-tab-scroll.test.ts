import { expect, it } from "vitest";
import { faceTabOverflow, faceTabScrollTo } from "./face-tab-scroll";

it("keeps both directions available only while the row overflows", () => {
  expect(faceTabOverflow(400, 200, 0)).toEqual({ overflow: true, left: false, right: true });
  expect(faceTabOverflow(400, 200, 100)).toEqual({ overflow: true, left: true, right: true });
  expect(faceTabOverflow(400, 200, 200)).toEqual({ overflow: true, left: true, right: false });
  expect(faceTabOverflow(200, 200, 0).overflow).toBe(false);
  expect(faceTabOverflow(201, 200, 0).overflow).toBe(false);
});

it("scrolls by most of the viewport and stops at the ends", () => {
  expect(faceTabScrollTo(0, 200, 500, 1)).toBe(160);
  expect(faceTabScrollTo(160, 200, 500, 1)).toBe(300);
  expect(faceTabScrollTo(0, 200, 500, -1)).toBe(0);
  expect(faceTabScrollTo(10, 80, 200, 1)).toBe(58);
});
