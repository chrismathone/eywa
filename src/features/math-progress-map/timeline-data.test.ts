import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { buildSampleProgress } from "./sample";
import { curriculumPeriods, detailDays } from "./timeline-data";
import { monthNearestCenter, wheelPixels } from "./timeline-navigation";

describe("세로 커리큘럼 데이터", () => {
  it("월별 계획·실적의 진도와 실제 현재 월을 그대로 사용한다", () => {
    const source = buildSampleProgress();
    const view = buildYearView(source);
    const periods = curriculumPeriods(view, source);
    expect(periods).toHaveLength(12);
    expect(periods.map((period) => period.progress)).toEqual(view.months.map((month) => month.pct));
    expect(periods.filter((period) => period.isActual).map((period) => period.month)).toEqual([9]);
    expect(periods[4]!.bookName).toBe(view.months[4]!.plan!.bookName);
    expect(periods[8]!.source.donePages).toBe(view.months[8]!.donePages);
    expect(detailDays(periods[8]!, source.asOf).some((day) => day.date === source.asOf && day.isToday)).toBe(true);
  });

  it("계획과 기록이 없는 달에 단원 수나 진도율을 만들지 않는다", () => {
    const source = { ...buildSampleProgress(), yearPlan: [], dailyProgress: [] };
    const periods = curriculumPeriods(buildYearView(source), source);
    expect(periods.every((period) => period.status === "no-plan" && period.progress === 0 && period.totalUnits === 0)).toBe(true);
    expect(periods[8]!.isActual).toBe(true);
  });
});

describe("타임라인 탐색", () => {
  it("높이가 다른 월도 화면 중앙과 월 중앙의 거리로 선택한다", () => {
    const bounds = [{ month: 8, top: 0, bottom: 100 }, { month: 9, top: 100, bottom: 700 }, { month: 10, top: 700, bottom: 800 }];
    expect(monthNearestCenter(bounds, 330, 8)).toBe(9);
    expect(monthNearestCenter(bounds, 700, 9)).toBe(10);
    expect(monthNearestCenter(bounds, 225, 9)).toBe(9);
    expect(monthNearestCenter([], 400, 3)).toBe(3);
  });
  it("마우스 휠의 픽셀·줄·페이지 단위를 정규화한다", () => {
    expect(wheelPixels(48, 0, 800)).toBe(48);
    expect(wheelPixels(-3, 1, 800)).toBe(-48);
    expect(wheelPixels(1, 2, 800)).toBe(800);
  });
});
