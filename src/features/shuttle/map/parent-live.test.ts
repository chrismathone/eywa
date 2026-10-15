import { describe, expect, it } from "vitest";
import { nearestLegKey, routeRoles } from "./parent-live";

const route = [
  { id: "d", kind: "depart" as const, mine: false },
  { id: "a", kind: "stop" as const, mine: false },
  { id: "b", kind: "stop" as const, mine: true },
  { id: "z", kind: "arrive" as const, mine: false },
];

describe("routeRoles", () => {
  it("등원은 우리 정류장에서 타고 학원 도착에서 내린다", () => {
    expect(Object.fromEntries(routeRoles(route, "in"))).toEqual({ b: "board", z: "alight" });
  });
  it("하원은 학원 출발에서 타고 우리 정류장에서 내린다", () => {
    expect(Object.fromEntries(routeRoles(route, "out"))).toEqual({ d: "board", b: "alight" });
  });
  it("학원 칸이 없으면 그쪽은 비운다", () => {
    expect(Object.fromEntries(routeRoles(route.slice(1, 3), "in"))).toEqual({ b: "board" });
  });
  it("우리 칸이 없으면 아무것도 없다", () => {
    expect(routeRoles(route.map((r) => ({ ...r, mine: false })), "in").size).toBe(0);
  });
});

describe("nearestLegKey", () => {
  const legs = [
    { key: "a", time: "14:40", trip: null },
    { key: "b", time: "16:15", trip: null },
    { key: "c", time: "18:30", trip: null },
  ];
  it("운행 중이 먼저", () => {
    expect(nearestLegKey([...legs.slice(0, 2), { key: "c", time: "18:30", trip: "running" as const }], 15 * 60)).toBe("c");
  });
  it("가장 가까운 시각", () => {
    expect(nearestLegKey(legs, 16 * 60)).toBe("b");
    expect(nearestLegKey(legs, 20 * 60)).toBe("c");
  });
  it("같은 간격이면 앞으로 올 것", () => {
    expect(nearestLegKey([{ key: "x", time: "15:00", trip: null }, { key: "y", time: "17:00", trip: null }], 16 * 60)).toBe("y");
  });
  it("시각이 없으면 첫 구간, 없으면 null", () => {
    expect(nearestLegKey([{ key: "x", time: null, trip: null }], 600)).toBe("x");
    expect(nearestLegKey([], 600)).toBeNull();
  });
});
