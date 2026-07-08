import { describe, it, expect } from "vitest";
import { buildWeekGrid, weekCellKey, type WeekGridRow } from "./week-grid";

const row = (
  subject: string,
  className: string,
  teacherName: string | null,
  slots: WeekGridRow["slots"],
): WeekGridRow => ({ subject, className, teacherName, slots });

describe("buildWeekGrid", () => {
  it("빈 입력 → 빈 격자", () => {
    const g = buildWeekGrid([]);
    expect(g.days).toEqual([]);
    expect(g.times).toEqual([]);
    expect(g.cells.size).toBe(0);
  });

  it("등장한 요일만 월→일 순으로(입력 순서 무관)", () => {
    const g = buildWeekGrid([
      row("english", "E반", "Anna", [
        { day: "fri", startTime: "16:00", periodLabel: "3교시" },
        { day: "mon", startTime: "16:00", periodLabel: "3교시" },
        { day: "wed", startTime: "16:00", periodLabel: "3교시" },
      ]),
    ]);
    // sat/sun 없음 → 제외. 월·수·금만, 요일 순서 정규화.
    expect(g.days).toEqual(["mon", "wed", "fri"]);
  });

  it("시각은 오름차순(문자열 정렬로 시간순), 중복 제거", () => {
    const g = buildWeekGrid([
      row("math", "M반", "김샘", [
        { day: "mon", startTime: "09:00", periodLabel: "1교시" },
        { day: "mon", startTime: "14:20", periodLabel: "5교시" },
      ]),
      row("english", "E반", "Anna", [
        { day: "mon", startTime: "09:00", periodLabel: "1교시" }, // 다른 과목 같은 시각
      ]),
    ]);
    expect(g.times).toEqual(["09:00", "14:20"]);
  });

  it("다른 과목·다른 강사가 같은 (요일,시각)에 있으면 한 셀에 두 항목(전 선생님 통합)", () => {
    const g = buildWeekGrid([
      row("math", "수학심화", "김수학", [
        { day: "tue", startTime: "18:00", periodLabel: "6교시" },
      ]),
      row("english", "영어리딩", "Anna", [
        { day: "tue", startTime: "18:00", periodLabel: "4교시" },
      ]),
    ]);
    const cell = g.cells.get(weekCellKey("tue", "18:00"));
    expect(cell).toHaveLength(2);
    expect(cell!.map((c) => c.teacherName).sort()).toEqual(["Anna", "김수학"]);
    // 과목별 교시 라벨이 각자 보존(체계가 달라도 시각으로 묶임).
    expect(cell!.find((c) => c.subject === "english")!.periodLabel).toBe("4교시");
    expect(cell!.find((c) => c.subject === "math")!.periodLabel).toBe("6교시");
  });

  it("서로 다른 (요일,시각)은 각각 별도 셀", () => {
    const g = buildWeekGrid([
      row("english", "E반", "Anna", [
        { day: "mon", startTime: "16:00", periodLabel: "3교시" },
        { day: "wed", startTime: "17:00", periodLabel: "4교시" },
      ]),
    ]);
    expect(g.cells.get(weekCellKey("mon", "16:00"))).toHaveLength(1);
    expect(g.cells.get(weekCellKey("wed", "17:00"))).toHaveLength(1);
    expect(g.cells.get(weekCellKey("mon", "17:00"))).toBeUndefined();
  });

  it("slots 없는 행(시간 미정)은 격자에 기여하지 않음", () => {
    const g = buildWeekGrid([row("math", "시간미정반", "김샘", [])]);
    expect(g.days).toEqual([]);
    expect(g.times).toEqual([]);
    expect(g.cells.size).toBe(0);
  });
});
