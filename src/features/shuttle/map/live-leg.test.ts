import { describe, expect, it } from "vitest";
import { liveLegPath, OFF_ROUTE_M } from "./live-leg";

// 위도 0.001 ≈ 111m. 동쪽으로 가는 두 구간: A(0) → B(0.002) → C(0.004) (경도).
const legs = [
  { path: [[35.9, 128.590], [35.9, 128.592]] as [number, number][], distanceM: 180, durationS: 60 },
  { path: [[35.9, 128.592], [35.9, 128.594]] as [number, number][], distanceM: 180, durationS: 120 },
];
const ends = ["침산초 후문", "칠성초 정문"];

describe("liveLegPath — 지금 위치 → 다음 정류장", () => {
  it("첫 구간 가운데면 다음 정류장은 그 구간 끝, 경로는 차 위치에서 시작", () => {
    const r = liveLegPath(legs, ends, { lat: 35.9, lng: 128.591 })!;
    expect(r.legIndex).toBe(0);
    expect(r.nextStop).toBe("침산초 후문");
    expect(r.path[0]).toEqual([35.9, 128.591]);
    expect(r.path[r.path.length - 1]).toEqual([35.9, 128.592]);
    expect(r.remainingS).toBe(30); // 절반 남음 × 60초
  });

  it("둘째 구간으로 넘어가면 다음 정류장도 바뀐다", () => {
    const r = liveLegPath(legs, ends, { lat: 35.9, lng: 128.5935 })!;
    expect(r.nextStop).toBe("칠성초 정문");
    expect(r.remainingS).toBe(30); // 1/4 남음 × 120초
  });

  it("🔴 노선에서 너무 멀면 판정하지 않는다", () => {
    expect(liveLegPath(legs, ends, { lat: 35.9 + (OFF_ROUTE_M + 100) / 111_000, lng: 128.591 })).toBeNull();
  });

  it("구간이 없으면 null", () => {
    expect(liveLegPath([], [], { lat: 35.9, lng: 128.59 })).toBeNull();
  });
});
