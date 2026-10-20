import { describe, expect, it } from "vitest";
import { axisTicks, endLabelOffsets, lastIndexWithValue, maskBefore, niceTop, textWidth } from "./chart-math";

describe("niceTop", () => {
  it("최댓값보다 조금 위의 보기 좋은 수", () => {
    expect(niceTop(421)).toBe(500);
    expect(niceTop(332)).toBe(500);
    expect(niceTop(188)).toBe(250);
    expect(niceTop(72)).toBe(100);
    expect(niceTop(9)).toBe(10);
  });
  it("0·음수는 10", () => {
    expect(niceTop(0)).toBe(10);
    expect(niceTop(-3)).toBe(10);
  });
});

describe("axisTicks", () => {
  it("다섯 칸 · 정수", () => {
    expect(axisTicks(500)).toEqual([0, 100, 200, 300, 400, 500]);
    expect(axisTicks(250)).toEqual([0, 50, 100, 150, 200, 250]);
    expect(axisTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
  });
});

describe("maskBefore", () => {
  const pts = [
    { key: "2025-12", date: "2025-12-31", count: 5 },
    { key: "2026-01", date: "2026-01-31", count: 6 },
    { key: "2026-02", date: "2026-02-28", count: 7 },
  ];
  it("경계 달 전 값은 비운다", () => expect(maskBefore(pts, "2026-01")).toEqual([null, 6, 7]));
  it("경계가 없으면 그대로", () => expect(maskBefore(pts, null)).toEqual([5, 6, 7]));
  it("연도별은 연말 날짜로", () => expect(maskBefore([{ key: "2025", date: "2025-12-31", count: 1 }, { key: "2026", date: "2026-10-20", count: 2 }], "2026-01")).toEqual([null, 2]));
});

describe("lastIndexWithValue", () => {
  it("마지막 값 칸", () => {
    expect(lastIndexWithValue([1, 2, null])).toBe(1);
    expect(lastIndexWithValue([null, null])).toBe(-1);
  });
});

describe("endLabelOffsets", () => {
  const scale = { top: 500, plotTop: 10, plotHeight: 200 };
  it("멀리 떨어진 라벨은 그대로", () => {
    const m = endLabelOffsets([{ key: "a", value: 400 }, { key: "b", value: 100 }], scale);
    expect(m.get("a")).toBe(0);
    expect(m.get("b")).toBe(0);
  });
  it("가까운 라벨은 gap만큼 벌린다", () => {
    const m = endLabelOffsets([{ key: "a", value: 231 }, { key: "b", value: 228 }], scale, 18);
    const ya = 10 + (1 - 231 / 500) * 200 + m.get("a")!;
    const yb = 10 + (1 - 228 / 500) * 200 + m.get("b")!;
    expect(Math.abs(yb - ya)).toBeGreaterThanOrEqual(18);
  });
  it("바닥을 넘으면 위로 되민다", () => {
    const m = endLabelOffsets([{ key: "a", value: 0 }, { key: "b", value: 0 }], scale, 18);
    const ys = ["a", "b"].map((k) => 210 + m.get(k)!);
    expect(Math.max(...ys)).toBeLessThanOrEqual(210);
    expect(Math.abs(ys[0]! - ys[1]!)).toBeGreaterThanOrEqual(18);
  });
});

describe("textWidth", () => {
  it("한글·숫자·공백", () => expect(textWidth("수학 188명")).toBe(14 * 3 + 4 + 8 * 3));
});
