import { describe, expect, it } from "vitest";
import { compareSortValues, nextSort, sortRows } from "./sort";

describe("정렬", () => {
  it("null은 오름/내림 무관하게 뒤", () => {
    const rows = [{ v: null }, { v: "b" }, { v: "a" }, { v: null }];
    const get = (r: { v: string | null }) => r.v;
    expect(sortRows(rows, { key: "v", dir: "asc" }, get).map((r) => r.v)).toEqual(["a", "b", null, null]);
    expect(sortRows(rows, { key: "v", dir: "desc" }, get).map((r) => r.v)).toEqual(["b", "a", null, null]);
  });
  it("숫자는 수치 비교, 문자열은 numeric collation(DT-2 < DT-10)", () => {
    expect(compareSortValues(2, 10)).toBeLessThan(0);
    expect(compareSortValues("DT-002", "DT-010")).toBeLessThan(0);
    expect(compareSortValues("가", "나")).toBeLessThan(0);
  });
  it("정렬 상태가 없으면 입력 순서 그대로(=sort_order)", () => {
    const rows = [{ v: "b" }, { v: "a" }];
    expect(sortRows(rows, null, (r) => r.v).map((r) => r.v)).toEqual(["b", "a"]);
  });
  it("같은 열을 다시 누르면 방향 토글, 다른 열은 오름차순부터", () => {
    expect(nextSort(null, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextSort({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
  it("원본 배열을 바꾸지 않는다", () => {
    const rows = [{ v: "b" }, { v: "a" }];
    sortRows(rows, { key: "v", dir: "asc" }, (r) => r.v);
    expect(rows.map((r) => r.v)).toEqual(["b", "a"]);
  });
});
