import { describe, expect, it } from "vitest";
import { columnBest, compareColumns, sortCompareRows, type CompareRow } from "./compare";

/** 직원별 항목 비교(원장 2026-10-15) — 열 구성 · 정렬(점수 없는 칸은 맨 아래) · 열마다 최고점. */
const cell = (id: string, value: number | null, raw: number | null = null) => ({ id, label: id, max: 10, value, raw, missing: false, uncounted: false });
const row = (teacherId: string, total: number | null, items: CompareRow["items"]): CompareRow => ({ teacherId, total, knownMax: 100, closed: true, items });
const rows = [
  row("a", 50, [cell("report", 8, 80), cell("counsel", null)]),
  row("b", 70, [cell("report", 6, 60), cell("counsel", 9, 90), cell("manual:x", 3)]),
  row("c", 50, [cell("report", 8, 80), cell("counsel", 2, 20)]),
];
const names: Record<string, string> = { a: "가", b: "나", c: "다" };

describe("직원별 항목 비교", () => {
  it("열 = 첫 행 차례 → 다른 행에만 있는 항목은 뒤에 · 단위는 지표 목록에서", () => {
    expect(compareColumns(rows).map((c) => [c.id, c.unit])).toEqual([["report", "%"], ["counsel", "%"], ["manual:x", ""]]);
  });
  it("높은 순 · 낮은 순 · 같으면 이름순 · 점수 없는 칸은 방향과 상관없이 맨 아래", () => {
    expect(sortCompareRows(rows, { key: "total", dir: "desc" }, (id) => names[id]!).map((r) => r.teacherId)).toEqual(["b", "a", "c"]);
    expect(sortCompareRows(rows, { key: "counsel", dir: "asc" }, (id) => names[id]!).map((r) => r.teacherId)).toEqual(["c", "b", "a"]);
    expect(sortCompareRows(rows, { key: "counsel", dir: "desc" }, (id) => names[id]!).map((r) => r.teacherId)).toEqual(["b", "c", "a"]);
  });
  it("열마다 최고점(같은 값이면 모두) — 값이 하나뿐이면 굵게 하지 않는다", () => {
    expect([columnBest(rows, "report"), columnBest(rows, "total"), columnBest(rows, "manual:x")]).toEqual([8, 70, null]);
  });
});
