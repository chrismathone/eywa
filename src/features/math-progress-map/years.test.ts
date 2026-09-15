import { describe, expect, it } from "vitest";
import { buildYearView } from "./derive";
import { buildSampleProgress } from "./sample";
import { availableYears, plannedDaysForMonth, progressForYear, stepContains } from "./years";

const sample = buildSampleProgress();
const serial = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1;

describe("입학부터 종강까지 장기 진도", () => {
  it("중등은 3개월, 고등 과정은 4개월로 끊김 없이 이어지고 2029년 2월 미적분1로 끝난다", () => {
    const steps = sample.roadmap!.steps;
    for (let i = 1; i < steps.length; i++) expect(serial(steps[i]!.startMonth)).toBe(serial(steps[i - 1]!.endMonth) + 1);
    for (const step of steps.filter((s) => s.estimated)) {
      expect(serial(step.endMonth) - serial(step.startMonth) + 1).toBe(step.label.startsWith("중") ? 3 : 4);
    }
    expect(steps.at(-1)).toMatchObject({ label: "미적분1", startMonth: "2028-11", endMonth: "2029-02" });
    expect(availableYears(sample)).toEqual([2026, 2027, 2028, 2029]);
  });

  it("연도를 바꿔도 실제 기준일·현재 교재·완료 기록은 바뀌지 않는다", () => {
    expect(progressForYear(sample, 2026)).toBe(sample);
    expect(progressForYear(sample, 2040)).toBe(sample);
    const future = progressForYear(sample, 2027);
    expect(future.year).toBe(2027);
    expect(future.asOf).toBe(sample.asOf);
    expect(future.curriculum).toBe(sample.curriculum);
    expect(buildYearView(sample)).toMatchObject({ plannedPages: 674, donePages: 431, pct: 64 });
  });

  it("미래 기록은 모두 예정이고, 일·주·월·연간 계획 쪽수 합이 일치한다", () => {
    for (const year of [2027, 2028, 2029]) {
      const progress = progressForYear(sample, year);
      expect(progress.dailyProgress.every((d) => d.status === "not-started" && d.completedPage === d.startPage - 1)).toBe(true);
      const view = buildYearView(progress);
      expect(view.donePages).toBe(0);
      expect(view.months.some((m) => m.isCurrent)).toBe(false);
      for (const month of view.months) {
        expect(month.plannedPages).toBe(month.weeks.reduce((sum, week) => sum + week.plannedPages, 0));
        expect(month.status).toBe(month.plan ? "planned" : "no-plan");
      }
      expect(view.plannedPages).toBe(progress.yearPlan.reduce((sum, p) => sum + p.endPage - p.startPage + 1, 0));
    }
  });

  it("연도를 넘기는 과정도 해당 연월에만 선택되고 종강 후에는 계획이 없다", () => {
    const calculus = sample.roadmap!.steps.at(-1)!;
    expect(stepContains(calculus, 2028, 11)).toBe(true);
    expect(stepContains(calculus, 2029, 2)).toBe(true);
    expect(stepContains(calculus, 2029, 11)).toBe(false);
    const final = progressForYear(sample, 2029);
    expect(final.yearPlan.map((p) => p.month)).toEqual([1, 2]);
    expect(final.dailyProgress.every((d) => d.date < "2029-03-01")).toBe(true);
  });

  it("기준일 이전·이번 달에는 추정 학습 기록을 생성하지 않는다", () => {
    expect(plannedDaysForMonth(2026, sample.yearPlan[0]!, sample.asOf)).toEqual([]);
    expect(plannedDaysForMonth(2026, sample.yearPlan[8]!, sample.asOf)).toEqual([]);
    expect(plannedDaysForMonth(2028, { ...sample.yearPlan[0]!, startPage: 0, endPage: 0 }, sample.asOf)).toEqual([]);
    const small = plannedDaysForMonth(2028, { ...sample.yearPlan[0]!, month: 2, startPage: 10, endPage: 12 }, sample.asOf);
    expect(small).toHaveLength(3);
    expect(small.at(-1)?.endPage).toBe(12);
  });
});
