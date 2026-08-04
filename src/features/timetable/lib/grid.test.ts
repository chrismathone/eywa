import { describe, expect, it } from "vitest";
import {
  cellClassKey,
  computeBlocks,
  dayGroupOf,
  expandHalfPeriodBlocks,
  mergeRuns,
  sortDaysByGroup,
} from "./grid";
import type { DayOfWeek } from "./periods";

// 2D 그리드 배열 → keyAt 함수
const grid = (g: string[][]) => (r: number, c: number) => g[r]![c]!;

describe("요일 그룹 정렬", () => {
  it("월목/화금/수/주말 순으로", () => {
    expect(sortDaysByGroup(["tue", "mon", "fri", "thu"])).toEqual(["mon", "thu", "tue", "fri"]);
    expect(sortDaysByGroup(["sat", "wed", "mon"])).toEqual(["mon", "wed", "sat"]);
  });
  it("그룹 판정", () => {
    expect(dayGroupOf("mon")).toBe(dayGroupOf("thu")); // 월목 동일
    expect(dayGroupOf("tue")).toBe(dayGroupOf("fri")); // 화금 동일
    expect(dayGroupOf("mon")).not.toBe(dayGroupOf("tue"));
    expect(dayGroupOf("sat")).toBe(dayGroupOf("sun")); // 주말 동일
  });
});

describe("셀 수업 키", () => {
  it("빈 셀은 빈 문자열", () => {
    expect(cellClassKey([])).toBe("");
  });
  it("classId 집합 정렬·중복 제거", () => {
    expect(cellClassKey(["c1"])).toBe("c1");
    expect(cellClassKey(["c2", "c1", "c1"])).toBe("c1|c2");
  });
});

describe("가로 병합(mergeRuns)", () => {
  const d = (xs: string[]) => xs as DayOfWeek[];
  it("월·목 같은 반 → colSpan 2 한 칸", () => {
    expect(mergeRuns(d(["mon", "thu"]), ["c1", "c1"])).toEqual([{ index: 0, span: 2 }]);
  });
  it("월·목 다른 반 → 각자", () => {
    expect(mergeRuns(d(["mon", "thu"]), ["c1", "c2"])).toEqual([
      { index: 0, span: 1 },
      { index: 1, span: 1 },
    ]);
  });
  it("빈 셀은 병합 안 함", () => {
    expect(mergeRuns(d(["mon", "thu"]), ["", ""])).toEqual([
      { index: 0, span: 1 },
      { index: 1, span: 1 },
    ]);
  });
  it("월목·화금 두 그룹 각각 병합", () => {
    expect(mergeRuns(d(["mon", "thu", "tue", "fri"]), ["c1", "c1", "c2", "c2"])).toEqual([
      { index: 0, span: 2 },
      { index: 2, span: 2 },
    ]);
  });
  it("다른 그룹은 같은 반이어도 병합 안 함(목·화)", () => {
    expect(mergeRuns(d(["thu", "tue"]), ["c1", "c1"])).toEqual([
      { index: 0, span: 1 },
      { index: 1, span: 1 },
    ]);
  });
  it("비인접(월·수·목 사이에 수)은 월목 병합 불가", () => {
    // 월(A)·수(C)·목(A): 인접쌍 월-수(그룹 다름), 수-목(그룹 다름) → 병합 없음
    expect(mergeRuns(d(["mon", "wed", "thu"]), ["c1", "c1", "c1"])).toEqual([
      { index: 0, span: 1 },
      { index: 1, span: 1 },
      { index: 2, span: 1 },
    ]);
  });
  it("단일 요일은 span 1", () => {
    expect(mergeRuns(d(["wed"]), ["c1"])).toEqual([{ index: 0, span: 1 }]);
  });
});

describe("2D 셀 병합(computeBlocks)", () => {
  it("같은 반 연속 3교시 세로 병합(rowSpan 3) — 주말 12~15시 한 칸", () => {
    const b = computeBlocks(3, 1, grid([["A"], ["A"], ["A"]]));
    expect(b.get("0:0")).toEqual({ rowSpan: 3, colSpan: 1 });
    expect(b.has("1:0")).toBe(false); // 피복 — 렌더 스킵
    expect(b.has("2:0")).toBe(false);
  });
  it("같은 반 월·목 2교시그룹 = 2×2 블록", () => {
    const b = computeBlocks(2, 2, grid([["A", "A"], ["A", "A"]]));
    expect(b.get("0:0")).toEqual({ rowSpan: 2, colSpan: 2 });
    expect(b.size).toBe(1);
  });
  it("빈 셀은 각자 1×1(병합 안 함)", () => {
    const b = computeBlocks(1, 2, grid([["", ""]]));
    expect(b.get("0:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(b.get("0:1")).toEqual({ rowSpan: 1, colSpan: 1 });
  });
  it("다른 반은 분리", () => {
    const b = computeBlocks(2, 1, grid([["A"], ["B"]]));
    expect(b.get("0:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(b.get("1:0")).toEqual({ rowSpan: 1, colSpan: 1 });
  });
  it("allowColMerge=false면 가로 병합 끔(주말 토/일), 세로는 유지", () => {
    expect(computeBlocks(1, 2, grid([["A", "A"]]), false).get("0:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(computeBlocks(2, 1, grid([["A"], ["A"]]), false).get("0:0")).toEqual({ rowSpan: 2, colSpan: 1 });
  });
  it("가로 우선 + 세로는 전체 폭 일치할 때만(L자 방지)", () => {
    // [[A,A],[A,B]] → (0,0) colSpan2, rowSpan1(아래 폭 불일치) / (1,0)·(1,1) 각자
    const b = computeBlocks(2, 2, grid([["A", "A"], ["A", "B"]]));
    expect(b.get("0:0")).toEqual({ rowSpan: 1, colSpan: 2 });
    expect(b.get("1:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(b.get("1:1")).toEqual({ rowSpan: 1, colSpan: 1 });
  });
});

describe("expandHalfPeriodBlocks (반교시 셀을 그룹 높이로)", () => {
  // 2행(=1교시 그룹) × 2열 격자. grid[r][c] = 그 칸에 수업이 있는가.
  const run = (grid: boolean[][], blocks: Map<string, { rowSpan: number; colSpan: number }>) =>
    expandHalfPeriodBlocks({
      blocks,
      pairs: [[0, 1]],
      occupied: (ri, ci) => grid[ri]?.[ci] ?? false,
    });

  it("윗 교시만 쓰는 수업 → 2칸으로 늘리고 수업명은 윗 절반", () => {
    const blocks = new Map([
      ["0:0", { rowSpan: 1, colSpan: 1 }],
      ["1:0", { rowSpan: 1, colSpan: 1 }],
    ]);
    const out = run([[true], [false]], blocks);
    expect(out.blocks.get("0:0")).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(out.blocks.has("1:0")).toBe(false); // 아랫 행은 피복 — 빈 칸이 따로 그려지지 않는다
    expect(out.subSlots.get("0:0")).toBe("top");
  });

  it("아랫 교시만 쓰는 수업 → anchor가 윗 행으로 올라오고 수업명은 아랫 절반", () => {
    const blocks = new Map([
      ["0:0", { rowSpan: 1, colSpan: 1 }],
      ["1:0", { rowSpan: 1, colSpan: 1 }],
    ]);
    const out = run([[false], [true]], blocks);
    expect(out.blocks.get("0:0")).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(out.blocks.has("1:0")).toBe(false);
    expect(out.subSlots.get("0:0")).toBe("bottom");
  });

  it("양쪽 교시에 서로 다른 수업 → 늘릴 자리가 없으니 그대로(각자 1칸)", () => {
    const blocks = new Map([
      ["0:0", { rowSpan: 1, colSpan: 1 }],
      ["1:0", { rowSpan: 1, colSpan: 1 }],
    ]);
    const out = run([[true], [true]], blocks);
    expect(out.blocks.get("0:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(out.blocks.get("1:0")).toEqual({ rowSpan: 1, colSpan: 1 });
    expect(out.subSlots.size).toBe(0);
  });

  it("이미 두 교시에 걸친 수업(완전체)은 손대지 않는다", () => {
    const blocks = new Map([["0:0", { rowSpan: 2, colSpan: 1 }]]);
    const out = run([[true], [true]], blocks);
    expect(out.blocks.get("0:0")).toEqual({ rowSpan: 2, colSpan: 1 });
    expect(out.subSlots.size).toBe(0);
  });

  it("가로 병합(월·목) 블록은 **두 열 모두** 반대쪽이 비어야 늘린다", () => {
    const wide = () => new Map([["0:0", { rowSpan: 1, colSpan: 2 }], ["1:0", { rowSpan: 1, colSpan: 1 }], ["1:1", { rowSpan: 1, colSpan: 1 }]]);
    // 아랫 행 한 열에 다른 수업이 있으면 확장 금지(그 칸을 덮어버리면 수업이 사라진다).
    const blocked = run([[true, true], [false, true]], wide());
    expect(blocked.blocks.get("0:0")).toEqual({ rowSpan: 1, colSpan: 2 });
    expect(blocked.subSlots.size).toBe(0);
    // 두 열 다 비었으면 확장.
    const ok = run([[true, true], [false, false]], wide());
    expect(ok.blocks.get("0:0")).toEqual({ rowSpan: 2, colSpan: 2 });
    expect(ok.blocks.has("1:0")).toBe(false);
    expect(ok.blocks.has("1:1")).toBe(false);
  });

  it("빈 칸만 있는 그룹은 아무것도 안 한다(입력 불변)", () => {
    const blocks = new Map([
      ["0:0", { rowSpan: 1, colSpan: 1 }],
      ["1:0", { rowSpan: 1, colSpan: 1 }],
    ]);
    const out = run([[false], [false]], blocks);
    expect(out.blocks.size).toBe(2);
    expect(out.subSlots.size).toBe(0);
    expect(blocks.get("0:0")).toEqual({ rowSpan: 1, colSpan: 1 }); // 원본 Map 안 건드림
  });
});
