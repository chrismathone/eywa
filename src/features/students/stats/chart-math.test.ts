import { describe, expect, it } from "vitest";
import { axisFloor, axisScale, axisTicks, maskBefore, niceTop, stackTotals, textWidth } from "./chart-math";

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

describe("textWidth", () => {
  it("한글·숫자·공백", () => expect(textWidth("수학 188명")).toBe(14 * 3 + 4 + 8 * 3));
});

describe("stackTotals", () => {
  it("같은 스택끼리 칸마다 더하고 · 모두 null인 칸은 null · 스택 없는 선은 뺀다", () => {
    const t = stackTotals(
      [
        { stack: "a", values: [1, null, 2] },
        { stack: "a", values: [3, null, null] },
        { values: [9, 9, 9] },
        { stack: "b", values: [0, 5, 0] },
      ],
      3,
    );
    expect(t.get("a")).toEqual([4, null, 2]);
    expect(t.get("b")).toEqual([0, 5, 0]);
    expect(t.size).toBe(2);
  });
});

describe("axisFloor · 바닥 있는 눈금", () => {
  it("90%대 비율은 90부터 · 낮은 값은 더 내려 · 0 아래는 안 간다", () => {
    expect(axisFloor(91.2, 100)).toBe(90);
    expect(axisFloor(62, 100)).toBe(50);
    expect(axisFloor(3, 100)).toBe(0);
    expect(axisFloor(0, 100)).toBe(0);
    expect(axisFloor(99.5, 100)).toBe(90);
  });
  it("눈금은 바닥부터 꼭대기까지 다섯 칸 안팎 · 정수 칸만 · 바닥은 칸의 배수로", () => {
    expect(axisTicks(100, 90)).toEqual([90, 92, 94, 96, 98, 100]);
    expect(axisTicks(10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(axisTicks(2)).toEqual([0, 1, 2]); // '0.4건' 눈금 없음
    expect(axisScale(100, 30)).toEqual({ bottom: 20, ticks: [20, 40, 60, 80, 100] });
    expect(axisTicks(250_000_000)).toEqual([0, 50_000_000, 100_000_000, 150_000_000, 200_000_000, 250_000_000]);
  });
});
