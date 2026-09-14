import { describe, expect, it } from "vitest";
import { CX, CY, RINGS, arcPath, dayAngles, dayRingAngles, monthAngles, polar, weekAngles, withGap } from "./geometry";

describe("progress-map geometry", () => {
  it("0° = 12시 방향, 시계 방향", () => {
    const top = polar(100, 0);
    expect(top.x).toBeCloseTo(CX);
    expect(top.y).toBeCloseTo(CY - 100);
    const right = polar(100, 90);
    expect(right.x).toBeCloseTo(CX + 100);
    expect(right.y).toBeCloseTo(CY);
  });

  it("달은 30°씩 — 안쪽 링의 하루·주 칸이 그 달 칸 안에 정확히 들어간다", () => {
    expect(monthAngles(9)).toEqual([240, 270]);
    expect(dayAngles("2026-09-01")).toEqual([240, 241]);
    expect(dayAngles("2026-09-30")[1]).toBeCloseTo(270);
    // 2월(28일)도 30°를 나눠 쓴다 — 하루 폭이 더 넓을 뿐 경계는 같다.
    expect(dayAngles("2026-02-28")[1]).toBeCloseTo(60);
    const w3 = weekAngles(2026, 9, 3)!;
    expect(w3[0]).toBeCloseTo(240 + 13);
    expect(w3[1]).toBeCloseTo(240 + 20);
    expect(weekAngles(2026, 9, 9)).toBeNull();
  });

  it("고리 조각 path는 바깥 호 → 안쪽 호로 닫힌다", () => {
    const d = arcPath(100, 200, 0, 90);
    expect(d.startsWith(`M ${CX} ${CY - 200}`)).toBe(true);
    expect(d).toContain("A 200 200 0 0 1");
    expect(d).toContain("A 100 100 0 0 0");
    expect(d.endsWith("Z")).toBe(true);
    // 180° 넘는 조각은 large-arc 플래그.
    expect(arcPath(100, 200, 0, 270)).toContain("A 200 200 0 1 1");
    expect(arcPath(100, 200, 10, 10)).toBe("");
  });

  it("일간 링은 초점 주의 가운데를 중심으로 하루 11°씩 — 7일이면 77°", () => {
    const cells = dayRingAngles(255, 7);
    expect(cells.length).toBe(7);
    expect(cells[0]![0]).toBeCloseTo(255 - 38.5);
    expect(cells[6]![1]).toBeCloseTo(255 + 38.5);
  });

  it("틈은 폭이 충분할 때만 뺀다", () => {
    expect(withGap([0, 30], 0.6)).toEqual([0.3, 29.7]);
    expect(withGap([0, 0.5], 0.6)).toEqual([0, 0.5]);
  });

  it("링 반지름이 안쪽부터 바깥으로 겹치지 않는다", () => {
    const bands = [RINGS.yearArc, RINGS.day, RINGS.week, RINGS.month, RINGS.year, RINGS.quarter];
    expect(RINGS.center).toBeLessThan(RINGS.yearArc[0]);
    for (let i = 1; i < bands.length; i++) expect(bands[i]![0]).toBeGreaterThan(bands[i - 1]![1]);
  });
});
