import { expect, it } from "vitest";
import { changePeriod, compareListScores } from "./list-controls";
it("양수·음수·0점을 숫자로 정렬하고 미집계는 양 방향 모두 마지막에 둔다", () => {
  const rows = [null, 7, -2, 0].map((value, i) => ({ id: String(i), name: String(i), value }));
  expect([...rows].sort((a, b) => compareListScores(a, b, "asc")).map((r) => r.value)).toEqual([-2, 0, 7, null]);
  expect([...rows].sort((a, b) => compareListScores(a, b, "desc")).map((r) => r.value)).toEqual([7, 0, -2, null]);
  expect(changePeriod("3")).toBe(3); expect(changePeriod("2")).toBe(12); expect(changePeriod("NaN")).toBe(12);
});
