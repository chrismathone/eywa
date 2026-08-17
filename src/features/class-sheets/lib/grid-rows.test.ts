import { describe, it, expect } from "vitest";
import { buildGridRows, isWeekendDow } from "./grid-rows";
import type { GridDay, GridSlot } from "./grid";

function slot(slotStart: string): GridSlot {
  return {
    slotStart,
    slotEnd: null,
    scheduled: true,
    teacherId: null,
    teacherLabel: null,
    roomLabel: null,
    lines: [],
    roster: [],
  };
}
function day(date: string, dow: GridDay["dow"], starts: string[]): GridDay {
  return { date, dow, slots: starts.map(slot) };
}

describe("isWeekendDow", () => {
  it("토·일만 주말", () => {
    expect(isWeekendDow("sat")).toBe(true);
    expect(isWeekendDow("sun")).toBe(true);
    expect(isWeekendDow("wed")).toBe(false);
  });
});

describe("buildGridRows — 서수 배치(N번째 수업끼리 같은 행)", () => {
  // 2026-07-29 원장 제보 재현: 수요일은 늦은 교시(19:20)만, 일요일은 이른 교시(15:40~)만.
  const mixed = [day("2026-07-29", "wed", ["19:20"]), day("2026-08-02", "sun", ["14:50", "15:40"])];

  it("평일+주말: 시각이 달라도 위로 채운다", () => {
    const rows = buildGridRows(mixed);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]?.slotStart).toBe("19:20"); // 수 첫 수업
    expect(rows[0]![1]?.slotStart).toBe("14:50"); // 일 첫 수업 — 같은 행
    expect(rows[1]![0]).toBeNull(); // 수는 수업 1개뿐
    expect(rows[1]![1]?.slotStart).toBe("15:40");
  });

  it("🔴 평일끼리도 서수 — 2026-08-17 원장 제보 재현(중등E_초등 브릿지 B: 수만 15:40, 화·금 16:00)", () => {
    // 시각 정렬이었다면 15:40이 행 하나를 차지해 화·금 둘째 카드가 셋째 행으로 밀렸다(= 공백).
    const rows = buildGridRows([
      day("2026-08-25", "tue", ["14:50", "16:00"]),
      day("2026-08-26", "wed", ["14:50", "15:40"]),
      day("2026-08-28", "fri", ["14:50", "16:00"]),
    ]);
    expect(rows).toHaveLength(2);
    // 둘째 행에 세 요일의 둘째 수업이 나란히 — 화·금에 빈 칸이 없다(카드가 위로 붙는다).
    expect(rows[1]!.map((c) => c?.slotStart)).toEqual(["16:00", "15:40", "16:00"]);
  });

  it("🔴 어떤 행도 전부 null이 아니다(공백 제거가 이 전략의 목적)", () => {
    for (const days of [
      mixed,
      [day("2026-07-27", "mon", ["15:40", "19:20"]), day("2026-07-28", "tue", ["19:20"])],
    ]) {
      const rows = buildGridRows(days);
      expect(rows.every((r) => r.some((c) => c !== null))).toBe(true);
      expect(rows[0]!.every((c) => c !== null)).toBe(true); // 첫 행은 모든 요일이 차 있다
    }
  });

  it("수업 수가 다른 요일은 뒤 행이 빈 칸", () => {
    const rows = buildGridRows([
      day("2026-07-27", "mon", ["15:40", "19:20"]),
      day("2026-07-28", "tue", ["19:20"]),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]?.slotStart).toBe("15:40");
    expect(rows[0]![1]?.slotStart).toBe("19:20"); // 화 첫 수업 — 시각 무관 첫 행
    expect(rows[1]![0]?.slotStart).toBe("19:20");
    expect(rows[1]![1]).toBeNull();
  });

  it("열 안 순서는 입력(buildWeekGrid의 시각순 정렬)을 그대로 보존한다", () => {
    const rows = buildGridRows([day("2026-07-27", "mon", ["09:00", "15:40", "19:20"])]);
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
