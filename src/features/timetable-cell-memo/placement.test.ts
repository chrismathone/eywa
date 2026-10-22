import { describe, expect, it } from "vitest";
import { fitToViewport, placeBeside } from "./placement";

const vp = { width: 1000, height: 700 };
const cell = { left: 300, top: 200, right: 365, bottom: 260 };

describe("메모 상자 자리 — 칸 옆(구글 시트 메모처럼)", () => {
  it("칸 오른쪽에 붙는다(틈 2px) · 위는 칸 위와 맞춘다", () => {
    expect(placeBeside(cell, { width: 240, height: 140 }, vp)).toEqual({ left: 367, top: 200 });
  });
  it("오른쪽이 모자라면 칸 왼쪽으로", () => {
    const right = { left: 900, top: 200, right: 965, bottom: 260 };
    expect(placeBeside(right, { width: 240, height: 140 }, vp)).toEqual({ left: 658, top: 200 });
  });
  it("아래가 모자라면 위로 올린다", () => {
    const low = { left: 300, top: 650, right: 365, bottom: 700 };
    expect(placeBeside(low, { width: 240, height: 140 }, vp).top).toBe(552);
  });
  it("끌어 바꾸는 크기는 화면 안으로", () => {
    expect(fitToViewport({ width: 640, height: 480 }, { left: 500, top: 400 }, vp)).toEqual({ width: 492, height: 292 });
  });
});
