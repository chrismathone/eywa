import { describe, expect, it } from "vitest";
import { cellSpecOf, visualColumns, type LaneCol } from "./grid-index";

/** 강사뷰 표 모양을 흉내 낸다 — [시각열] + 레인(김태건 목 2레인 · 이현이 목 1레인). */
const lanes: LaneCol[] = [
  { col: "김태건", day: "thu" },
  { col: "김태건", day: "thu" },
  { col: "이현이", day: "thu" },
];

describe("표 구조로 칸의 화면 열을 되짚는다(칸마다 속성을 싣지 않는다)", () => {
  it("세로 병합 칸이 덮은 자리는 다음 행에서 건너 센다", () => {
    // 0행: 시각 | 블록(2행 병합) | 빈칸 | 빈칸
    // 1행: 시각 | (덮임)          | 빈칸 | 빈칸
    // 2행: 시각 | 합반(가로 2칸)        | 빈칸
    const rows = [
      [{ rowSpan: 1, colSpan: 1 }, { rowSpan: 2, colSpan: 1 }, { rowSpan: 1, colSpan: 1 }, { rowSpan: 1, colSpan: 1 }],
      [{ rowSpan: 1, colSpan: 1 }, { rowSpan: 1, colSpan: 1 }, { rowSpan: 1, colSpan: 1 }],
      [{ rowSpan: 1, colSpan: 1 }, { rowSpan: 1, colSpan: 2 }, { rowSpan: 1, colSpan: 1 }],
    ];
    expect(visualColumns(rows)).toEqual([
      [0, 1, 2, 3],
      [0, 2, 3],
      [0, 1, 3],
    ]);
  });
});

describe("칸 → 메모 자리", () => {
  const axis = { firstMin: 960, stepMin: 10 };
  it("빈 칸 = 그 행 10분 · 열쇠는 행 시작", () => {
    expect(cellSpecOf({ row: 2, col: 3, rowSpan: 1 }, null, lanes, axis)).toEqual({
      col: "이현이", day: "thu", from: 980, to: 990, keyStart: 980,
    });
  });
  it("수업 블록 = 덮은 행 전부 · 열쇠는 블록 시작(행 간격과 무관)", () => {
    expect(cellSpecOf({ row: 2, col: 1, rowSpan: 6 }, 980, lanes, axis)).toEqual({
      col: "김태건", day: "thu", from: 980, to: 1040, keyStart: 980,
    });
  });
  it("🔴 30분 간격 — 16:20 블록은 16:00 행에 서도 열쇠는 16:20 그대로", () => {
    const wide = { firstMin: 960, stepMin: 30 };
    expect(cellSpecOf({ row: 0, col: 1, rowSpan: 2 }, 980, lanes, wide)).toEqual({
      col: "김태건", day: "thu", from: 960, to: 1020, keyStart: 980,
    });
  });
  it("시각열·모르는 열은 메모 자리가 아니다", () => {
    expect(cellSpecOf({ row: 0, col: 0, rowSpan: 1 }, null, lanes, axis)).toBeNull();
    expect(cellSpecOf({ row: 0, col: 9, rowSpan: 1 }, null, lanes, axis)).toBeNull();
  });
});
