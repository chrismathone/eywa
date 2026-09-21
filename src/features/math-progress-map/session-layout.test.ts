import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { focusOfDate, resolveWeek } from "./focus";
import { dayAngles, midAngle } from "./geometry";
import type { DailyProgress, StudentProgress } from "./model";
import { buildSampleProgress } from "./sample";
import { classDaysOfWeek, daySessionLayout, weekSessionLayout } from "./session-layout";

function week(date = "2026-09-17", overrides: Partial<StudentProgress> = {}) {
  return resolveWeek(buildYearView({ ...buildSampleProgress(), year: Number(date.slice(0, 4)), dailyProgress: [],
    calendar: { classWeekdays: [1, 4] }, ...overrides }), focusOfDate(date));
}

const makeup = (date: string): DailyProgress => ({ date, bookName: "", chapter: "", subChapter: "복습 보강",
  startPage: 0, endPage: 0, completedPage: 0, status: "completed" });

describe("수업 회차 기반 시계 배치", () => {
  it("월·목만 주 전체를 나누고 비수업 요일·빈칸은 만들지 않는다", () => {
    const w = week(), cells = weekSessionLayout(w);
    expect(cells.map(c => c.day.date)).toEqual(["2026-09-14", "2026-09-17"]);
    expect(cells[0].angles[0]).toBe(dayAngles(w.start)[0]);
    expect(cells[1].angles[1]).toBe(dayAngles(w.end)[1]);
    expect(cells[0].angles[1]).toBe(cells[1].angles[0]);
    expect(cells[0].angles[1] - cells[0].angles[0]).toBeCloseTo(3.5);
  });

  it("실제 보강·0차시 복습은 주 중간에도 날짜순으로 끼워 넣고 진도 합계는 그대로 둔다", () => {
    const w = week("2026-09-17", { dailyProgress: [makeup("2026-09-19"), makeup("2026-09-16")] });
    const cells = weekSessionLayout(w);
    expect(cells.map(c => c.day.date)).toEqual(["2026-09-14", "2026-09-16", "2026-09-17", "2026-09-19"]);
    expect(cells.every(c => c.angles[1] - c.angles[0] === 1.75)).toBe(true);
    expect(w.plannedPages).toBe(0);
    expect(w.donePages).toBe(0);
  });

  it("보고서 없는 예정 보강도 명시된 수업 일정에 있으면 표시한다", () => {
    const w = week("2026-09-17", { calendar: { classDates: ["2026-09-19", "2026-09-17", "2026-09-14"] } });
    expect(classDaysOfWeek(w).map(d => d.date)).toEqual(["2026-09-14", "2026-09-17", "2026-09-19"]);
  });

  it("휴강은 빼되 공휴일의 실제 보강 기록은 남긴다", () => {
    const calendar = { classWeekdays: [1, 4], daysOff: { "2026-09-24": "휴강" } };
    const closed = week("2026-09-24", { calendar });
    expect(classDaysOfWeek(closed).map(d => d.date)).toEqual(["2026-09-21"]);
    const taught = week("2026-09-24", { calendar, dailyProgress: [makeup("2026-09-24")] });
    expect(classDaysOfWeek(taught).map(d => d.date)).toEqual(["2026-09-21", "2026-09-24"]);
    expect(classDaysOfWeek(taught)[1].holidayName).toBeTruthy();
  });

  it("일정 미확인은 수업을 만들지 않고 명시적인 휴강 기록도 표시하지 않는다", () => {
    expect(weekSessionLayout(week("2026-09-17", { calendar: undefined }))).toEqual([]);
    expect(daySessionLayout(week("2026-09-17", { calendar: { classDates: [] } }), "2026-09-17")).toEqual([]);
    const w = week("2026-09-17", { dailyProgress: [{ ...makeup("2026-09-17"), status: "no-plan" }] });
    expect(classDaysOfWeek(w).map(d => d.date)).toEqual(["2026-09-14"]);
  });

  it("선택 수업의 요일 부채꼴을 압축된 바깥 눈금과 맞춘다", () => {
    const w = week("2026-09-17", { dailyProgress: [makeup("2026-09-19")] });
    for (const date of ["2026-09-14", "2026-09-17", "2026-09-19"]) {
      const cells = daySessionLayout(w, date), selected = cells.find(c => c.day.date === date)!;
      expect(cells).toHaveLength(3);
      expect(midAngle(selected.angles)).toBeCloseTo(midAngle(selected.tickAngles));
      expect(cells.at(-1)!.angles[1] - cells[0].angles[0]).toBeCloseTo(33);
    }
  });

  it("비수업일 조회는 다음 수업에 맞추고 마지막 수업 뒤에는 마지막 수업에 맞춘다", () => {
    for (const [date, anchor] of [["2026-09-16", "2026-09-17"], ["2026-09-20", "2026-09-17"]]) {
      const cells = daySessionLayout(week(), date), selected = cells.find(c => c.day.date === anchor)!;
      expect(cells).toHaveLength(2);
      expect(midAngle(selected.angles)).toBeCloseTo(midAngle(selected.tickAngles));
    }
  });

  it.each(["2026-02-01", "2026-08-31", "2027-01-01", "2028-02-29", "2028-12-31"])(
    "%s의 짧은 주·윤년·연도 경계에서도 원래 주차 범위를 유지한다", date => {
      const w = week(date, { calendar: { classDates: [date] } }), cells = weekSessionLayout(w);
      expect(cells).toHaveLength(1);
      expect(cells[0].angles).toEqual([dayAngles(w.start)[0], dayAngles(w.end)[1]]);
      expect(daySessionLayout(w, date)[0].angles.every(Number.isFinite)).toBe(true);
    },
  );
});
