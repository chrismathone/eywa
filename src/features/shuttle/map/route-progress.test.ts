import { describe, expect, it } from "vitest";
import { busSlot, describeProgress, doneIndexOf, routeProgress } from "./route-progress";

// 동서로 늘어선 칸 — 학원 출발(0) → A(1) → B(2) → 학원 도착(3, 출발과 같은 자리)
const A0 = { lat: 35.88, lng: 128.59 };
const east = (m: number) => ({ lat: 35.88, lng: 128.59 + m / (111_320 * Math.cos((35.88 * Math.PI) / 180)) });
const stops = [A0, east(900), east(1800), A0];

describe("routeProgress — 기록 바닥 + GPS", () => {
  it("기록이 없으면 학원(출발·도착 같은 자리)에서도 '출발'에 둔다", () => {
    const r = routeProgress(stops, A0, 0)!;
    expect(r.pos).toBe(0);
    expect(r.atStop).toBe(0);
  });
  it("바닥~다음 칸 사이 위치를 소수로", () => {
    const r = routeProgress(stops, east(450), 0)!;
    expect(r.pos).toBeCloseTo(0.5, 1);
    expect(r.atStop).toBeNull();
  });
  it("GPS가 앞서 가도 다음 칸까지만", () => {
    const r = routeProgress(stops, east(1800), 0)!;
    expect(r.pos).toBe(1);
  });
  it("뒤로 가지 않는다 — 바닥 칸에 둔다", () => {
    const r = routeProgress(stops, A0, 2)!;
    expect(r.pos).toBeGreaterThanOrEqual(2);
  });
  it("마지막 정류장 기록 뒤 학원 근처면 '도착'", () => {
    const r = routeProgress(stops, A0, 2)!;
    expect(r.atStop).toBe(3);
  });
  it("좌표 없는 칸은 건너뛰고 앞뒤 좌표 칸을 잇는다", () => {
    const r = routeProgress([A0, { lat: null, lng: null }, east(1800)], east(450), 0)!;
    expect(r.pos).toBeCloseTo(0.5, 1);
  });
  it("멀리 있으면 노선 이탈", () => {
    expect(routeProgress(stops, { lat: 35.9, lng: 128.59 }, 0)!.offRoute).toBe(true);
  });
  it("좌표 칸이 없으면 null", () => {
    expect(routeProgress([{ lat: null, lng: null }], A0)).toBeNull();
  });
});

describe("doneIndexOf", () => {
  const route = [
    { stopId: null, kind: "depart" },
    { stopId: "s1", kind: "stop" },
    { stopId: "s2", kind: "stop" },
    { stopId: null, kind: "arrive" },
  ];
  it("가장 뒤 기록 칸 · 없으면 0", () => {
    expect(doneIndexOf(route, [])).toBe(0);
    expect(doneIndexOf(route, ["s2", "s1"])).toBe(2);
    expect(doneIndexOf(route, ["zz"])).toBe(0);
  });
});

describe("busSlot · describeProgress", () => {
  it("구간 앞 절반은 앞 칸, 뒤 절반은 뒤 칸", () => {
    expect(busSlot(1, 5)).toEqual({ cell: 1, leftPct: 50 });
    expect(busSlot(1.25, 5)).toEqual({ cell: 1, leftPct: 75 });
    expect(busSlot(1.75, 5)).toEqual({ cell: 2, leftPct: 25 });
    expect(busSlot(9, 5)).toEqual({ cell: 4, leftPct: 50 });
  });
  it("문구", () => {
    const names = ["학원 출발", "A", "B"];
    expect(describeProgress({ pos: 0, atStop: null, distM: 10, offRoute: false }, names, "방금", false)).toBe("🚌 지금 학원 출발에 있어요 · 방금");
    expect(describeProgress({ pos: 1.4, atStop: null, distM: 10, offRoute: false }, names, "25초 전", false)).toBe("🚌 A → B 사이를 지나고 있어요 · 25초 전");
    expect(describeProgress({ pos: 0, atStop: null, distM: 1500, offRoute: true }, names, "방금", false)).toContain("1.5km");
    expect(describeProgress({ pos: 1, atStop: 1, distM: 10, offRoute: false }, names, "3분 전", true)).toContain("위치 끊김(3분 전)");
  });
});
