import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { buildSampleProgress } from "./sample";
import { curriculumPeriods, detailDays, quarterCurriculumLabel } from "./timeline-data";
import { progressForYear } from "./years";
import { monthAtScrollPosition, monthNearestCenter, wheelPixels } from "./timeline-navigation";
import { monthPosition } from "./continuous-timeline";

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
    expect(quarterCurriculumLabel(periods.slice(0, 3))).toBe("학습 계획 미등록");
  });

  it("분기 안내는 실제 과정과 과정 전환을 표시한다", () => {
    const source = buildSampleProgress();
    const periods = curriculumPeriods(buildYearView(progressForYear(source, 2028)), source);
    expect(quarterCurriculumLabel(periods.filter((period) => period.quarter === 1))).toBe("공통수학1 → 공통수학2 학습");
    expect(quarterCurriculumLabel(periods.filter((period) => period.quarter === 2))).toBe("공통수학2 학습");
    const final = curriculumPeriods(buildYearView(progressForYear(source, 2029)), source);
    expect(quarterCurriculumLabel(final.filter((period) => period.quarter === 1))).toBe("미적분1 학습");
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

  it("스크롤 양 끝은 화면 중앙의 월 대신 입학 월과 종강 월을 선택한다", () => {
    const first = monthPosition(2026, 1), last = monthPosition(2029, 2);
    const bounds = [{ month: first, top: 10, bottom: 70 }, { month: first + 4, top: 300, bottom: 380 }, { month: last, top: 700, bottom: 1200 }];
    expect(monthAtScrollPosition(bounds, 350, first + 4, 0, 3000)).toBe(first);
    expect(monthAtScrollPosition(bounds, 350, first + 4, 3000, 3000)).toBe(last);
    expect(monthAtScrollPosition([...bounds].reverse(), 350, first + 4, 0, 3000)).toBe(first);
    expect(monthAtScrollPosition(bounds, 350, first, 1500, 3000)).toBe(first + 4);
  });

  it("소수점 스크롤과 탄성 스크롤에서도 양 끝에 도달하고 짧은 목록은 중앙 기준을 유지한다", () => {
    const bounds = [{ month: 1, top: 0, bottom: 100 }, { month: 2, top: 100, bottom: 800 }, { month: 3, top: 800, bottom: 900 }];
    for (const top of [-15, 0, 0.75]) expect(monthAtScrollPosition(bounds, 400, 2, top, 900)).toBe(1);
    for (const top of [899.5, 900, 920]) expect(monthAtScrollPosition(bounds, 400, 2, top, 900)).toBe(3);
    expect(monthAtScrollPosition(bounds, 400, 2, 2, 900)).toBe(2);
    expect(monthAtScrollPosition(bounds, 400, 2, 0, 0)).toBe(2);
    expect(monthAtScrollPosition([], 400, 2, 0, 900)).toBe(2);
  });
});
