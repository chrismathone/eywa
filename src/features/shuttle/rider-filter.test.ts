import { describe, expect, it } from "vitest";
import { applyRiderFilter } from "./rider-filter";

const slot = (id: string, ids: string[]) => ({ id, students: ids.map((studentId) => ({ studentId })) });

describe("applyRiderFilter — 셔틀 탑승 학생만", () => {
  const slots = [slot("a", ["s1", "s2"]), slot("b", ["s3"]), slot("c", [])];
  it("탑승 학생만 남기고, 탑승 학생이 없는 반·빈 반은 뺀다", () => {
    const out = applyRiderFilter(slots, new Set(["s1"]));
    expect(out.map((s) => [s.id, s.students.map((x) => x.studentId)])).toEqual([["a", ["s1"]]]);
  });
  it("명단이 그대로면 같은 객체를 돌려준다 · null이면 필터 안 씀", () => {
    expect(applyRiderFilter(slots, new Set(["s3"]))[0]).toBe(slots[1]);
    expect(applyRiderFilter(slots, null)).toBe(slots);
  });
});
