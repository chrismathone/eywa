import { describe, expect, it } from "vitest";
import { cellClassKey, dayGroupOf, mergeRuns, sortDaysByGroup } from "./grid";
import type { DayOfWeek } from "./periods";

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
