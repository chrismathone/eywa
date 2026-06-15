import { describe, it, expect } from "vitest";
import {
  clampRect,
  cascadeNext,
  snapTarget,
  snapZoneForPoint,
  resizeRect,
  bringToFront,
  layoutSlots,
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
  it("좌상 1/4", () => expect(snapTarget("tl", B)).toEqual({ x: 0, y: 0, w: 600, h: 400 }));
  it("우상 1/4", () => expect(snapTarget("tr", B)).toEqual({ x: 600, y: 0, w: 600, h: 400 }));
  it("좌하 1/4", () => expect(snapTarget("bl", B)).toEqual({ x: 0, y: 400, w: 600, h: 400 }));
  it("우하 1/4", () => expect(snapTarget("br", B)).toEqual({ x: 600, y: 400, w: 600, h: 400 }));
  it("null", () => expect(snapTarget(null, B)).toBeNull());
});

describe("snapZoneForPoint", () => {
  it("상단 중앙=max", () => expect(snapZoneForPoint(600, 5, B)).toBe("max"));
  it("좌 중앙=left", () => expect(snapZoneForPoint(5, 400, B)).toBe("left"));
  it("우 중앙=right", () => expect(snapZoneForPoint(1195, 400, B)).toBe("right"));
  it("중앙=null", () => expect(snapZoneForPoint(600, 400, B)).toBeNull());
  it("좌상 모서리=tl", () => expect(snapZoneForPoint(5, 5, B)).toBe("tl"));
  it("우상 모서리=tr", () => expect(snapZoneForPoint(1195, 5, B)).toBe("tr"));
  it("좌하 모서리=bl", () => expect(snapZoneForPoint(5, 795, B)).toBe("bl"));
  it("우하 모서리=br", () => expect(snapZoneForPoint(1195, 795, B)).toBe("br"));
  it("모서리가 절반보다 우선(좌 가장자리 + corner 밴드)", () =>
    expect(snapZoneForPoint(5, 60, B)).toBe("tl"));
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

describe("layoutSlots", () => {
  it("split: 앵커 좌 → 좌/우 절반", () =>
    expect(layoutSlots("split", B, "left")).toEqual([
      { x: 0, y: 0, w: 600, h: 800 },
      { x: 600, y: 0, w: 600, h: 800 },
    ]));
  it("split: 앵커 우 → 슬롯0이 우측", () =>
    expect(layoutSlots("split", B, "right")).toEqual([
      { x: 600, y: 0, w: 600, h: 800 },
      { x: 0, y: 0, w: 600, h: 800 },
    ]));
  it("stack(1+2): 앵커 좌 full + 우 상/하 ¼", () =>
    expect(layoutSlots("stack", B, "left")).toEqual([
      { x: 0, y: 0, w: 600, h: 800 },
      { x: 600, y: 0, w: 600, h: 400 },
      { x: 600, y: 400, w: 600, h: 400 },
    ]));
  it("stack(1+2): 앵커 우 → 좌측 스택", () =>
    expect(layoutSlots("stack", B, "right")).toEqual([
      { x: 600, y: 0, w: 600, h: 800 },
      { x: 0, y: 0, w: 600, h: 400 },
      { x: 0, y: 400, w: 600, h: 400 },
    ]));
  it("thirds: 앵커 좌 → 좌·중·우 컬럼", () =>
    expect(layoutSlots("thirds", B, "left")).toEqual([
      { x: 0, y: 0, w: 400, h: 800 },
      { x: 400, y: 0, w: 400, h: 800 },
      { x: 800, y: 0, w: 400, h: 800 },
    ]));
  it("thirds: 앵커 우 → 슬롯0이 우측 컬럼", () =>
    expect(layoutSlots("thirds", B, "right")).toEqual([
      { x: 800, y: 0, w: 400, h: 800 },
      { x: 400, y: 0, w: 400, h: 800 },
      { x: 0, y: 0, w: 400, h: 800 },
    ]));
  it("thirds 컬럼 합 = 전체 폭(틈 없음)", () => {
    const s = layoutSlots("thirds", B, "left");
    expect(s[0].w + s[1].w + s[2].w).toBe(B.width);
  });
});

describe("bringToFront", () => {
  it("맨 끝으로 이동", () => expect(bringToFront(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]));
  it("이미 앞이면 그대로(idempotent)", () => expect(bringToFront(["b", "c", "a"], "a")).toEqual(["b", "c", "a"]));
});
