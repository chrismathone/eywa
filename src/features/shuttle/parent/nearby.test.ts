import { describe, expect, it } from "vitest";
import { candidateStops, meters, rankByWalk, type NetRun, type NetStop, type Walked } from "./nearby";

// 위도 0.001 ≈ 111m.
const home = { lat: 35.88, lng: 128.59 };
const stops: NetStop[] = [
  { id: "near", name: "가까운 정류장", lat: 35.881, lng: 128.59 }, // ≈111m
  { id: "mid", name: "중간 정류장", lat: 35.884, lng: 128.59 }, // ≈444m
  { id: "far", name: "먼 정류장", lat: 35.9, lng: 128.59 }, // ≈2.2km
  { id: "lonely", name: "회차 없는 정류장", lat: 35.8805, lng: 128.59 },
];
const run = (id: string, dir: "in" | "out", at: [string, string][]): NetRun => ({
  id,
  vehicleName: "2호차",
  runName: `${id}회차`,
  direction: dir,
  academyTime: null,
  stops: at.map(([stopId, time]) => ({ stopId, time })),
});
const runs = [
  run("2", "out", [["near", "18:20"], ["far", "18:40"]]),
  run("3", "in", [["mid", "16:15"]]),
  run("1", "in", [["near", "14:50"]]),
];

describe("candidateStops — 직선으로 후보 추리기", () => {
  it("반경 안에서 회차가 지나는 정류장만, 직선 가까운 순", () => {
    const c = candidateStops(home, stops, runs);
    expect(c.map((s) => s.stop.id)).toEqual(["near", "mid"]); // 먼 정류장(반경 밖)·회차 없는 정류장 제외
    expect(c[0]!.straightM).toBeGreaterThan(100);
    expect(c[0]!.straightM).toBeLessThan(120);
  });

  it("정류장 안 회차는 등원 먼저, 같은 방향은 정류장 시각 순", () => {
    expect(candidateStops(home, stops, runs)[0]!.runs.map((x) => `${x.run.direction}:${x.run.id}`)).toEqual(["in:1", "out:2"]);
  });

  it("후보 수 상한", () => {
    expect(candidateStops(home, stops, runs, { max: 1 })).toHaveLength(1);
  });
});

describe("rankByWalk — 도보 순위", () => {
  const c = candidateStops(home, stops, runs);
  it("🔑 순위는 직선이 아니라 도보 거리 — 직선으로 가까워도 걸어서 멀면 뒤로", () => {
    const walks = new Map<string, Walked>([
      ["near", { distanceM: 900, walkMin: 13 }], // 직선 111m지만 돌아가야 한다
      ["mid", { distanceM: 500, walkMin: 7 }],
    ]);
    const r = rankByWalk(c, walks);
    expect(r.map((s) => `${s.rank}:${s.stop.id}`)).toEqual(["1:mid", "2:near"]);
  });

  it("도보 길을 못 잰 정류장은 뺀다", () => {
    expect(rankByWalk(c, new Map([["mid", { distanceM: 500, walkMin: 7 }]])).map((s) => s.stop.id)).toEqual(["mid"]);
  });

  it("5등까지", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ stop: { id: `s${i}`, name: "", lat: 0, lng: 0 }, straightM: i, runs: [] }));
    const walks = new Map(many.map((m, i) => [m.stop.id, { distanceM: 100 * i, walkMin: i }]));
    expect(rankByWalk(many, walks)).toHaveLength(5);
  });

  it("meters — 위도 0.001° ≈ 111m", () => {
    expect(Math.round(meters({ lat: 35, lng: 128 }, { lat: 35.001, lng: 128 }))).toBe(111);
  });
});
