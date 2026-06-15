import { describe, it, expect } from "vitest";
import {
  clampRect,
  cascadeNext,
  snapTarget,
  snapZoneForPoint,
  resizeRect,
  bringToFront,
  MIN_W,
  MIN_H,
} from "./window-geometry";

const B = { width: 1200, height: 800 };

describe("clampRect", () => {
  it("범위 안은 그대로", () => {
    expect(clampRect({ x: 100, y: 100, w: 480, h: 560 }, B)).toEqual({ x: 100, y: 100, w: 480, h: 560 });
  });
  it("음수 좌표는 0으로", () => {
    expect(clampRect({ x: -50, y: -30, w: 480, h: 560 }, B)).toMatchObject({ x: 0, y: 0 });
  });
  it("우/하 오버플로면 안으로 당김", () => {
    const r = clampRect({ x: 1100, y: 700, w: 480, h: 560 }, B);
    expect(r.x).toBe(1200 - 480);
    expect(r.y).toBe(800 - 560);
  });
  it("최소 크기 보장", () => {
    const r = clampRect({ x: 0, y: 0, w: 100, h: 100 }, B);
    expect(r.w).toBe(MIN_W);
    expect(r.h).toBe(MIN_H);
  });
});

describe("cascadeNext", () => {
  it("첫 창은 좌상단 근처", () => {
    expect(cascadeNext(0, B)).toMatchObject({ x: 24, y: 24 });
  });
  it("인덱스만큼 오프셋", () => {
    expect(cascadeNext(1, B).x).toBeGreaterThan(cascadeNext(0, B).x);
  });
  it("항상 범위 안", () => {
    for (let i = 0; i < 50; i++) {
      const r = cascadeNext(i, B);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(B.width);
      expect(r.y + r.h).toBeLessThanOrEqual(B.height);
    }
  });
});

describe("snapTarget", () => {
  it("좌 절반", () => expect(snapTarget("left", B)).toEqual({ x: 0, y: 0, w: 600, h: 800 }));
  it("우 절반", () => expect(snapTarget("right", B)).toEqual({ x: 600, y: 0, w: 600, h: 800 }));
  it("최대화", () => expect(snapTarget("max", B)).toEqual({ x: 0, y: 0, w: 1200, h: 800 }));
  it("null", () => expect(snapTarget(null, B)).toBeNull());
});

describe("snapZoneForPoint", () => {
  it("상단=max", () => expect(snapZoneForPoint(600, 5, B)).toBe("max"));
  it("좌=left", () => expect(snapZoneForPoint(5, 400, B)).toBe("left"));
  it("우=right", () => expect(snapZoneForPoint(1195, 400, B)).toBe("right"));
  it("중앙=null", () => expect(snapZoneForPoint(600, 400, B)).toBeNull());
});

describe("resizeRect", () => {
  it("e 핸들은 너비 증가", () => {
    const r = resizeRect({ x: 100, y: 100, w: 480, h: 560 }, "e", 40, 0, B);
    expect(r.w).toBe(520);
    expect(r.x).toBe(100);
  });
  it("w 핸들은 좌변 이동 + 너비 감소", () => {
    const r = resizeRect({ x: 100, y: 100, w: 480, h: 560 }, "w", 40, 0, B);
    expect(r.x).toBe(140);
    expect(r.w).toBe(440);
  });
  it("최소 너비 이하로 안 줄어듦(이동변 보정)", () => {
    const r = resizeRect({ x: 100, y: 100, w: MIN_W, h: 560 }, "w", 200, 0, B);
    expect(r.w).toBe(MIN_W);
    expect(r.x + r.w).toBe(100 + MIN_W); // 우변 고정
  });
  it("se는 양방향", () => {
    const r = resizeRect({ x: 100, y: 100, w: 480, h: 560 }, "se", 40, 30, B);
    expect(r.w).toBe(520);
    expect(r.h).toBe(590);
  });
});

describe("bringToFront", () => {
  it("맨 끝으로 이동", () => expect(bringToFront(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]));
  it("이미 앞이면 그대로(idempotent)", () => expect(bringToFront(["b", "c", "a"], "a")).toEqual(["b", "c", "a"]));
});
