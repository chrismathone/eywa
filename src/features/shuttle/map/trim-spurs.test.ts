import { describe, expect, it } from "vitest";
import { trimSpurs } from "./trim-spurs";

// 경도 0.001 ≈ 90m(위도 35.88). 큰길은 동쪽으로(경도 증가), 골목은 북쪽으로(위도 증가, 0.001 ≈ 111m).
const P = (lat: number, lng: number): [number, number] => [lat, lng];

describe("trimSpurs — 정류장 앞 왕복 꼬리 자르기", () => {
  it("🔑 골목으로 들어갔다 같은 길로 나오면 둘 다 자르고 큰길 갈림목에서 잇는다", () => {
    const legs = [
      { path: [P(35.88, 128.59), P(35.88, 128.591), P(35.881, 128.591)], distanceM: 200, durationS: 60 }, // 큰길 90m → 골목 111m
      { path: [P(35.881, 128.591), P(35.88, 128.591), P(35.88, 128.592)], distanceM: 200, durationS: 60 }, // 골목 111m 되돌아 → 큰길 90m
    ];
    const out = trimSpurs(legs);
    // 갈림목은 4m 간격으로 재므로 모서리에서 몇 m 안쪽에 잡힌다 — 큰길 위(위도 그대로) · 모서리 10m 안이면 된다.
    const end = out[0]!.path[out[0]!.path.length - 1]!;
    expect(end[0]).toBeCloseTo(35.88, 5);
    expect(Math.abs(end[1] - 128.591)).toBeLessThan(0.00011);
    expect(out[1]!.path[0]).toEqual(end); // 두 구간이 같은 점에서 만난다
    expect(out[1]!.path[out[1]!.path.length - 1]).toEqual(P(35.88, 128.592));
    expect(out[0]!.distanceM).toBeLessThan(200);
    expect(out[1]!.durationS).toBeLessThan(60);
  });

  it("🔴 다른 길로 빠져나가면 자르지 않는다", () => {
    const legs = [
      { path: [P(35.88, 128.59), P(35.88, 128.591), P(35.881, 128.591)], distanceM: 200, durationS: 60 },
      { path: [P(35.881, 128.591), P(35.881, 128.593)], distanceM: 180, durationS: 50 }, // 골목 끝에서 동쪽 다른 길로
    ];
    const out = trimSpurs(legs);
    expect(out[0]!.path).toHaveLength(3);
    expect(out[1]!.path).toHaveLength(2);
  });

  it("🔴 왕복이 너무 길면(400m 초과) 그대로 둔다 — 정말 그 길을 오가는 노선일 수 있다", () => {
    const legs = [
      { path: [P(35.88, 128.59), P(35.885, 128.59)], distanceM: 555, durationS: 120 },
      { path: [P(35.885, 128.59), P(35.88, 128.59)], distanceM: 555, durationS: 120 },
    ];
    const out = trimSpurs(legs);
    expect(out[0]!.path).toEqual(legs[0]!.path);
  });
});
