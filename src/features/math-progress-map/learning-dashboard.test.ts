import { describe, expect, it } from "vitest";
import { buildLearningDashboard, periodCount, periodPercent } from "./learning-dashboard";
import { buildLearningMap, lessonsInPeriod, mapPeriod, periodMetrics } from "./learning-map";
import { learningMapFixture } from "./learning-map.test-fixture";
import { buildYearView, donePagesOf, plannedPagesOf } from "./derive";
import { progressForYear } from "./years";
import { curriculumPeriods } from "./timeline-data";
import { paceLabel, planVsActual } from "./pace";
import { dayOf, focusOfDate } from "./focus";

describe("기존 전체 진도맵의 실데이터 배선", () => {
  it("세 지도가 실제 반별 수업일을 공유하며 과거 진도는 발송 보고서의 수업일에만 그린다", () => {
    const f = learningMapFixture();
    const map = buildLearningMap(f.goal, f.progress);
    const data = buildLearningDashboard(f.student, f.goal, f.progress, f.records, map, f.context);
    const view = buildYearView(data);
    expect(dayOf(view, focusOfDate("2026-09-15"))).toMatchObject({ noClassReason: "수업 없는 날", isClassDay: false });
    expect(dayOf(view, focusOfDate("2026-09-17"))).toMatchObject({ noClassReason: null, isClassDay: true });
    expect(dayOf(view, focusOfDate("2026-09-24"))).toMatchObject({ noClassReason: "휴일", isClassDay: false });
    const past = view.months.flatMap(month => month.weeks.flatMap(week => week.days)).filter(day => day.donePages > 0);
    expect(past.every(day => f.records.some(record => record.date === day.date))).toBe(true);
    const nextYear = progressForYear(data, 2027);
    expect(nextYear.calendar?.classDates?.every(date => date.startsWith("2027-"))).toBe(true);
    expect(nextYear.calendar?.classDates?.length).toBeGreaterThan(0);
    const makeup = { date: "2026-09-19", progress: "보강", textbook: null };
    const withMakeup = buildLearningDashboard(f.student, f.goal, f.progress, [...f.records, makeup], map, f.context);
    expect(dayOf(buildYearView(withMakeup), focusOfDate(makeup.date))).toMatchObject({ noClassReason: null, isClassDay: true });
  });
  it("일·주·월·분기·연간 합계와 타임라인이 차시 원장의 동일한 분자·분모를 쓴다", () => {
    const f = learningMapFixture();
    const map = buildLearningMap(f.goal, f.progress);
    const data = buildLearningDashboard(f.student, f.goal, f.progress, f.records, map);
    let total = 0, reached = 0;
    for (const year of map.years) {
      const yearly = progressForYear(data, year);
      const view = buildYearView(yearly);
      const expected = periodMetrics(lessonsInPeriod(map, mapPeriod({date:`${year}-01-01`, mode:"year"})), true);
      expect([view.donePages, view.plannedPages]).toEqual([expected.current, expected.total]);
      total += view.plannedPages; reached += view.donePages;
      for (const month of view.months) {
        expect(month.plannedPages).toBe(month.weeks.reduce((sum, week) => sum + week.plannedPages, 0));
        expect(month.donePages).toBe(month.weeks.reduce((sum, week) => sum + week.donePages, 0));
        for (const week of month.weeks) {
          expect(week.plannedPages).toBe(week.days.reduce((sum, day) => sum + day.plannedPages, 0));
          expect(week.donePages).toBe(week.days.reduce((sum, day) => sum + day.donePages, 0));
        }
      }
      for (const quarter of view.quarters) expect(quarter.plannedPages).toBe(quarter.months.reduce((sum, month) => sum + month.plannedPages, 0));
      for (const period of curriculumPeriods(view, yearly)) expect([period.completedUnits, period.totalUnits]).toEqual([period.source.donePages, period.source.plannedPages]);
    }
    const undated = map.lessons.filter(lesson => lesson.inGoal && !lesson.calendarDate);
    expect(total + undated.length).toBe(map.metrics.total);
    expect(reached + undated.filter(lesson => lesson.reached).length).toBe(map.metrics.current);
    expect(paceLabel(planVsActual(data))).toBe("3차시 느림");
  });
  it("비연속 차시와 중복 보고서를 범위 길이로 부풀리지 않는다", () => {
    const f = learningMapFixture();
    const map = buildLearningMap(f.goal, f.progress);
    const dated = map.lessons.filter(lesson => lesson.inGoal).slice(0, 3);
    dated.forEach((lesson, index) => { lesson.calendarDate = index === 1 ? "2026-07-03" : "2026-07-02"; });
    const data = buildLearningDashboard(f.student, f.goal, f.progress, [...f.records, ...f.records], map);
    expect(new Set(data.dailyProgress.map(day => day.date)).size).toBe(data.dailyProgress.length);
    const day = data.dailyProgress.find(day => day.date === "2026-07-02")!;
    expect(plannedPagesOf(day)).toBe(day.lessons!.positions.length);
    expect(donePagesOf(day)).toBe(day.lessons!.done);
    const noMatch = data.dailyProgress.find(day => day.date === "2026-09-14")!;
    expect(noMatch.note).toContain("내신");
    expect(data.dailyProgress.find(day => day.date === "2026-07-02")!.status).not.toBe("no-plan");
  });
  it("수업일 없는 목표와 현재 진도 미확인은 계획·완료 사실을 만들지 않는다", () => {
    const f = learningMapFixture();
    const progress = { ...f.progress, days: [], currentBlock: null, current: null };
    const map = buildLearningMap(f.goal, progress);
    const data = buildLearningDashboard(f.student, f.goal, progress, f.records, map);
    const view = buildYearView(data);
    expect(map.lessons.filter(lesson => lesson.inGoal && !lesson.calendarDate).length).toBeGreaterThan(0);
    expect(periodCount(data, view.donePages, view.plannedPages)).toMatch(/^—/);
    expect(periodPercent(data, 0, 10)).toBe("—");
    expect(curriculumPeriods(view, data).some(period => period.status === "completed")).toBe(false);
  });
});
