import { describe, expect, it } from "vitest";
import { buildLearningProgress, learningTopicPositions } from "@/features/math-sheets/lib/learning-plan";
import { learningRailMetrics } from "@/features/math-sheets/lib/learning-axis";
import { buildLearningHistory } from "@/features/math-sheets/lib/learning-history";
import { buildLearningMap, lessonsInPeriod, mapChildren, mapPeriod, periodMetrics, readMapSelection } from "./learning-map";
import { learningMapFixture } from "./learning-map.test-fixture";

describe("실제 진도맵과 MCS 공통 차시 원장", () => {
  it("샘플 쪽수 없이 원본 진도율·기준일 계획·남은 수업·속도를 모두 공유한다", () => {
    const { goal, progress } = learningMapFixture();
    const map = buildLearningMap(goal, progress);
    expect(map.metrics).toEqual(learningRailMetrics(goal, progress));
    expect(map.metrics).toMatchObject({ current: 59, total: 155, percent: 38 });
    expect(map.lessons.filter(lesson => lesson.reached)).toHaveLength(59);
    expect(map.lessons[58].label).toBe("중2 2학기, 직각삼각형의 합동");
  });
  it("날짜 미확정 차시도 분모에 포함하고 연도·분기·월·주·일 합계를 보존한다", () => {
    const { goal, progress } = learningMapFixture();
    const map = buildLearningMap(goal, progress);
    let total = map.lessons.filter(lesson => lesson.inGoal && !lesson.calendarDate).length;
    expect(total).toBeGreaterThan(0);
    function check(period: ReturnType<typeof mapPeriod>) {
      const parent = lessonsInPeriod(map, period);
      const children = mapChildren(period);
      if (!children.length) return;
      const lists = children.map(child => lessonsInPeriod(map, child));
      expect(lists.flat().map(lesson => lesson.position).sort((a, b) => a - b)).toEqual(parent.map(lesson => lesson.position));
      expect(new Set(lists.flat().map(lesson => lesson.position)).size).toBe(parent.length);
      expect(lists.reduce((n, list) => n + (periodMetrics(list, true).current ?? 0), 0)).toBe(periodMetrics(parent, true).current);
      children.forEach(check);
    }
    for (const year of map.years) {
      const period = mapPeriod({ mode: "year", date: `${year}-01-01` });
      check(period); total += lessonsInPeriod(map, period).length;
    }
    expect(total).toBe(map.metrics.total);
  });
  it("기준일 이전이라는 이유로 진도를 생성하지 않고 미래 보고서도 세지 않는다", () => {
    const { goal, context, records } = learningMapFixture();
    const noData = buildLearningProgress(goal, context, [{ ...records[0], progress: "내신대비" }], "2026-09-18");
    const map = buildLearningMap(goal, noData);
    expect(map.metrics.current).toBeNull();
    expect(map.lessons.every(lesson => lesson.reached === null)).toBe(true);
    expect(periodMetrics(map.lessons, false).percent).toBeNull();
    const future = buildLearningProgress(goal, context, [...records, { ...records[0], date: "2026-10-01", progress: goal.endBlock }], "2026-09-18");
    expect(buildLearningMap(goal, future).metrics.current).toBe(59);
  });
  it("같은 차시 반복·여러 보고서와 내신대비는 차시 수를 부풀리지 않는다", () => {
    const { goal, context, records, progress } = learningMapFixture();
    const duplicate = buildLearningProgress(goal, context, [...records, ...records], "2026-09-18");
    duplicate.history = { ...buildLearningHistory(goal, duplicate, [...records, ...records], "2025-01-01", "2026-09-18"), start: null };
    expect(buildLearningMap(goal, duplicate)).toEqual(buildLearningMap(goal, progress));
    expect(duplicate.currentDate).toBe("2026-08-27");
    expect(duplicate.latestRecord?.date).toBe("2026-09-14");
  });
  it("후퇴·복습해도 마지막 실제 위치와 같은 분자가 된다", () => {
    const { goal, context, records } = learningMapFixture();
    const progress = buildLearningProgress(goal, context, [...records, { ...records[0], date: "2026-09-17" }], "2026-09-18");
    const map = buildLearningMap(goal, progress);
    expect(map.metrics.current).toBe(58);
    expect(map.lessons.filter(lesson => lesson.reached)).toHaveLength(58);
  });
  it("등록 시점으로 잘린 시작점을 그대로 사용한다", () => {
    const { goal, progress, records } = learningMapFixture();
    progress.history = buildLearningHistory(goal, progress, records, "2026-07-01", "2026-09-18");
    const map = buildLearningMap(goal, progress);
    expect(map.lessons[0].lesson).toBe("이등변삼각형의 성질");
    expect(map.metrics).toMatchObject({ current: 2, total: 98 });
    expect(map.lessons).toHaveLength(98);
  });
  it("오래 다닌 학생도 첫 기록에서 선을 자른다 — 기록 없는 앞 두 학기를 칠하지 않는다(원장 2026-09-21)", () => {
    // 2025-01 등록 · 첫 보고서 2026-07-02. 예전엔 시작을 '모름'으로 두어 중1 2학기부터 155차시(59 도달)로 그렸다.
    const { goal, progress, records } = learningMapFixture();
    progress.history = buildLearningHistory(goal, progress, records, "2025-01-01", "2026-09-18");
    const map = buildLearningMap(goal, progress);
    expect(progress.history.start).toEqual({ grade: "중2", lesson: "이등변삼각형의 성질" });
    expect(map.lessons[0].lesson).toBe("이등변삼각형의 성질");
    expect(map.metrics).toMatchObject({ current: 2, total: 98 });
    expect(map.lessons.filter(lesson => lesson.reached)).toHaveLength(2);
  });
  it("일정 누락 시 계획일은 미확정으로 남고 실제 보고서 수업일은 유지한다", () => {
    const { goal, progress } = learningMapFixture();
    const map = buildLearningMap(goal, { ...progress, days: [], status: "no-schedule" });
    const known = map.lessons.find(lesson => lesson.lesson === "직각삼각형의 합동")!;
    expect(known.date).toBe("2026-08-27");
    expect(known.plannedDate).toBeNull();
    expect(known.calendarDate).toBe("2026-08-27");
    expect(map.metrics.status).toBe("no-schedule");
  });
  it("완료한 진도를 미래 계획일로 그리지 않고 확인된 수업일에만 놓는다", () => {
    const f = learningMapFixture();
    const map = buildLearningMap(f.goal, f.progress);
    const dates = new Set(f.records.map(record => record.date));
    for (const lesson of map.lessons.filter(lesson => lesson.reached && lesson.calendarDate)) expect(dates.has(lesson.calendarDate!)).toBe(true);
    expect(map.lessons.find(lesson => lesson.position === map.metrics.current)?.calendarDate).toBe(f.progress.currentDate);
    expect(map.lessons.filter(lesson => lesson.reached && !lesson.date).every(lesson => lesson.calendarDate === null)).toBe(true);
  });
  it("목표 날짜 배분은 실제 수업일과 공휴일·수강 종료 조건을 따른다", () => {
    const { goal, progress } = learningMapFixture();
    const map = buildLearningMap(goal, progress);
    const course = learningTopicPositions(goal);
    for (const lesson of map.lessons.filter(lesson => lesson.plannedDate)) {
      const block = course.find(topic => topic.grade === lesson.grade && topic.lesson === lesson.lesson)!.block;
      const day = progress.days.find(day => day.date === lesson.plannedDate)!;
      expect(day.target).toBeGreaterThanOrEqual(block);
      expect(progress.days.filter(other => other.date < day.date).every(other => other.target < block)).toBe(true);
      expect(lesson.plannedDate).not.toBe("2026-09-24");
    }
  });
  it("날짜·모드·차시 URL 오염은 안전한 범위로 정규화한다", () => {
    const { goal, progress } = learningMapFixture();
    const map = buildLearningMap(goal, progress);
    expect(readMapSelection(new URLSearchParams("date=2026-02-30&view=wrong&lesson=99999"), map)).toEqual({ date: "2026-09-18", mode: "year", lesson: null, undated: false });
    expect(readMapSelection(new URLSearchParams("date=2099-01-01&lesson=-3"), map).date).toBe(map.referenceDate);
  });
  it("윤년의 월말과 짧은 주도 날짜를 빠뜨리거나 중복하지 않는다", () => {
    const month = mapPeriod({ date: "2028-02-29", mode: "month" });
    const days = mapChildren(month).flatMap(mapChildren);
    expect(days).toHaveLength(29);
    expect(new Set(days.map(day => day.from)).size).toBe(29);
    expect(days.at(-1)?.from).toBe("2028-02-29");
  });
  it("새 학기로 표시 구간이 이동해도 저장한 단원으로 복원한다", () => {
    const { goal, progress } = learningMapFixture();
    const original = buildLearningMap(goal, progress);
    const next = buildLearningMap(goal, { ...progress, currentBlock: "중3 · 제곱근의 뜻과 성질" });
    const params = new URLSearchParams({ date: "2026-08-27", topic: "중2:직각삼각형의 합동", view: "day" });
    const oldSelection = readMapSelection(params, original), nextSelection = readMapSelection(params, next);
    expect(oldSelection.lesson).not.toBe(nextSelection.lesson);
    expect(next.lessons[nextSelection.lesson! - 1].lesson).toBe("직각삼각형의 합동");
  });
});
