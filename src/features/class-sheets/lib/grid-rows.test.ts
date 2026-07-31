import { describe, it, expect } from "vitest";
import { buildGridRows, hasMixedDayKinds, isWeekendDow } from "./grid-rows";
import type { GridDay, GridSlot } from "./grid";

function slot(slotStart: string): GridSlot {
  return {
    slotStart,
    slotEnd: null,
    scheduled: true,
    teacherId: null,
    teacherLabel: null,
    roomLabel: null,
    specialRoom: null,
    lines: [],
    roster: [],
  };
}
function day(date: string, dow: GridDay["dow"], starts: string[]): GridDay {
  return { date, dow, slots: starts.map(slot) };
}

describe("isWeekendDow / hasMixedDayKinds", () => {
  it("토·일만 주말", () => {
    expect(isWeekendDow("sat")).toBe(true);
    expect(isWeekendDow("sun")).toBe(true);
    expect(isWeekendDow("wed")).toBe(false);
  });

  it("평일과 주말이 함께 있을 때만 혼합", () => {
    expect(hasMixedDayKinds([{ dow: "wed" }, { dow: "sun" }])).toBe(true);
    expect(hasMixedDayKinds([{ dow: "mon" }, { dow: "wed" }])).toBe(false);
    expect(hasMixedDayKinds([{ dow: "sat" }, { dow: "sun" }])).toBe(false);
    expect(hasMixedDayKinds([])).toBe(false);
  });
});

describe("buildGridRows — 혼합(평일+주말) = 서수 배치", () => {
  // 원장 제보 재현: 수요일은 늦은 교시(19:20)만, 일요일은 이른 교시(15:40~)만.
  const days = [day("2026-07-29", "wed", ["19:20"]), day("2026-08-02", "sun", ["14:50", "15:40"])];

  it("N번째 수업끼리 같은 행 — 시각이 달라도 위로 채운다", () => {
    const rows = buildGridRows(days);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]?.slotStart).toBe("19:20"); // 수 첫 수업
    expect(rows[0]![1]?.slotStart).toBe("14:50"); // 일 첫 수업 — 같은 행
    expect(rows[1]![0]).toBeNull(); // 수는 수업 1개뿐
    expect(rows[1]![1]?.slotStart).toBe("15:40");
  });

  it("🔴 시각 정렬이었다면 생겼을 빈 행이 없다(공백 제거가 이 전략의 목적)", () => {
    const rows = buildGridRows(days);
    // 어떤 행도 전부 null이면 안 된다(= 통째로 빈 줄)
    expect(rows.every((r) => r.some((c) => c !== null))).toBe(true);
    // 첫 행은 양쪽 다 차 있다(시각 정렬이면 한쪽이 비었을 자리)
    expect(rows[0]!.every((c) => c !== null)).toBe(true);
  });
});

describe("buildGridRows — 단일 종류 = 시각 배치(기존 동작 유지)", () => {
  it("평일만: 같은 교시가 같은 행, 없는 요일은 빈 칸", () => {
    const rows = buildGridRows([
      day("2026-07-27", "mon", ["15:40", "19:20"]),
      day("2026-07-28", "tue", ["19:20"]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]?.slotStart).toBe("15:40");
    expect(rows[0]![1]).toBeNull(); // 화요일엔 15:40 없음 = 빈 칸(정렬 유지)
    expect(rows[1]![0]?.slotStart).toBe("19:20");
    expect(rows[1]![1]?.slotStart).toBe("19:20");
  });

  it("주말만: 마찬가지로 시각 정렬", () => {
    const rows = buildGridRows([day("2026-08-01", "sat", ["10:00"]), day("2026-08-02", "sun", ["10:00"])]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.every((c) => c?.slotStart === "10:00")).toBe(true);
  });

  it("시각 정렬은 사전순=시각순(zero-padded HH:MM)", () => {
    const rows = buildGridRows([day("2026-07-27", "mon", ["19:20", "09:00", "15:40"])]);
    expect(rows.map((r) => r[0]?.slotStart)).toEqual(["09:00", "15:40", "19:20"]);
  });
});

describe("buildGridRows — 형태 불변식", () => {
  it("모든 행의 길이 = 요일 수(열 정렬이 어긋나지 않게)", () => {
    for (const days of [
      [day("2026-07-29", "wed", ["19:20"]), day("2026-08-02", "sun", ["14:50", "15:40"])],
      [day("2026-07-27", "mon", ["15:40"]), day("2026-07-28", "tue", ["19:20"])],
    ]) {
      for (const row of buildGridRows(days)) expect(row).toHaveLength(days.length);
    }
  });

  it("요일이 없으면 빈 행렬", () => {
    expect(buildGridRows([])).toEqual([]);
  });
});
