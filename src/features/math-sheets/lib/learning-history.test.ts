import { describe, expect, it } from "vitest";
import { buildLearningHistory } from "./learning-history";
import { buildLearningProgress, planLearningGoal } from "./learning-plan";
import { learningRailMetrics, learningTopicTicks, learningCurrentPosition, learningTargetPosition } from "./learning-axis";
import { flatLessons } from "@/features/onescreen/curriculum";

const lessons = flatLessons("중2");
const goal = planLearningGoal({ studentId: "s", studyGrade: "중2", startBlock: lessons[0], endBlock: lessons.at(-1)!, startDate: "2026-07-01", endDate: "2026-12-31", textbook: null });
const context = { schedules: ["mon", "thu"].map(dayOfWeek => ({ dayOfWeek, startTime: "16:00", endTime: "17:00", validFrom: null, validTo: null })), holidays: {}, spans: { s: [{ start: "2026-01-01", end: null }] } };
const records = [
  { date: "2026-06-01", progress: lessons[0], textbook: null },
  { date: "2026-07-13", progress: lessons[10], textbook: null },
  { date: "2026-07-23", progress: lessons[15], textbook: null },
  { date: "2026-08-31", progress: "삼각형의 내심", textbook: null },
];
const base = buildLearningProgress(goal, context, records, "2026-09-18");

describe("등록 이후 수업보고서로 복원한 진도", () => {
  it("등록 전 기록을 제외하고 학생별 시작 차시로 선을 잘라낸다", () => {
    const history = buildLearningHistory(goal, base, records, "2026-07-09", "2026-09-18");
    expect(history.fromDate).toBe("2026-07-09");
    expect(history.start?.lesson).toBe(lessons[10]);
    expect(history.lessons.some(item => item.lesson === lessons[0])).toBe(false);
    const ticks = learningTopicTicks(goal, { ...base, history });
    expect(ticks[0].lesson).toBe(lessons[10]);
    expect(ticks.length).toBeLessThan(learningTopicTicks(goal, base).length);
  });
  it("보고서의 날짜는 보존하고 사이의 빠진 차시 날짜만 추정으로 채운다", () => {
    const history = buildLearningHistory(goal, base, records, "2026-07-09", "2026-09-18");
    expect(history.lessons.find(item => item.lesson === lessons[10])).toMatchObject({ date: "2026-07-13", estimated: false });
    expect(history.lessons.find(item => item.lesson === lessons[11])).toMatchObject({ date: "2026-07-15", estimated: true });
    expect(history.lessons.find(item => item.lesson === lessons[15])).toMatchObject({ date: "2026-07-23", estimated: false });
    expect(history.lessons.every(item => item.date >= "2026-07-09" && item.date <= "2026-09-18")).toBe(true);
  });
  it("오래 재원한 학생도 날짜는 최근 1년으로 제한하고 윤년 날짜를 보정한다", () => {
    const history = buildLearningHistory(goal, base, records, "2020-01-01", "2026-09-18");
    expect(history.fromDate).toBe("2025-09-18");
    expect(history.start).toBeNull();
    expect(learningTopicTicks(goal, { ...base, history })).toHaveLength(learningTopicTicks(goal, base).length);
    expect(buildLearningHistory(goal, base, [], "2020-01-01", "2024-02-29").fromDate).toBe("2023-02-28");
  });
  it("전체 진도율·계획 차이·남은 수업당 필요 진도를 모두 같은 차시로 계산한다", () => {
    const progress = { ...base, history: buildLearningHistory(goal, base, records, "2026-07-09", "2026-09-18") };
    const ticks = learningTopicTicks(goal, progress);
    const summary = learningRailMetrics(goal, progress, ticks);
    expect(summary.current).toBe(learningCurrentPosition(goal, progress, ticks));
    expect(summary.total).toBe(learningTargetPosition(goal, ticks));
    expect(summary.percent).toBe(Math.round(summary.current! / summary.total * 100));
    expect(summary.difference).toBe(summary.current! - summary.target);
    expect(summary.requiredPace).toBe((summary.total - summary.current!) / summary.remainingDays);
    expect(summary.remainingDays).toBeGreaterThan(0);
    expect(summary.total).not.toBe(base.total);
  });
  it("완료한 학생에게 음수 필요 진도를 표시하지 않는다", () => {
    const done = buildLearningProgress(goal, context, [{ date: "2026-09-18", progress: lessons.at(-1)!, textbook: null }], "2026-09-18");
    const summary = learningRailMetrics(goal, done);
    expect(summary.percent).toBe(100);
    expect(summary.requiredPace).toBe(0);
    expect(summary.status).toBe("done");
  });
  it("과거 두 차시를 포함해도 실제·계획·목표 모두 같은 시작점으로 계산한다", () => {
    const short = { ...goal, startBlock: lessons[10], endBlock: lessons[19], blockCount: null, milestones: [] };
    const state = {
      ...base, currentBlock: lessons[13], target: 5,
      history: { enrolledAt: "2026-07-01", fromDate: "2026-07-01", start: { grade: "중2", lesson: lessons[8] }, lessons: [] },
      days: [
        { date: "2026-09-17", target: 5, block: lessons[14] },
        { date: "2026-09-21", target: 8, block: lessons[17] },
        { date: "2026-09-24", target: 10, block: lessons[19] },
      ],
    };
    expect(learningRailMetrics(short, state)).toEqual({
      current: 6, total: 12, target: 7, percent: 50, difference: -1,
      remainingDays: 2, requiredPace: 3, status: "on",
    });
    expect(learningRailMetrics(short, { ...state, currentBlock: lessons[20] })).toMatchObject({
      current: 13, total: 12, percent: 108, requiredPace: 0, status: "done",
    });
  });
  it("진도 미확인과 남은 수업 없음은 숫자를 추정하지 않는다", () => {
    expect(learningRailMetrics(goal, { ...base, currentBlock: null })).toMatchObject({ current: null, percent: null, difference: null, requiredPace: null });
    expect(learningRailMetrics(goal, { ...base, days: [] })).toMatchObject({ remainingDays: 0, requiredPace: null });
  });
  it("여러 학년에 걸친 목표의 시작 전 단원도 보고서 진도로 표시한다", () => {
    const later = planLearningGoal({ ...goal, startBlock: lessons[15], endStudyGrade: "중3", endBlock: flatLessons("중3").at(-1)! });
    const state = buildLearningProgress(later, context, [{ date: "2026-09-17", progress: lessons[10], textbook: null }], "2026-09-18");
    expect(state.current).toBe(0);
    expect(state.currentBlock).toBe(`중2 · ${lessons[10]}`);
    expect(learningRailMetrics(later, state).current).toBeGreaterThan(0);
  });
  it("복습 심화도 내신대비 중에는 목표 시작 전 마지막 확인 단원을 이어받는다", () => {
    const supplement = planLearningGoal({ ...goal, track: "supplement", startDate: "2026-09-01", endDate: "2026-09-30" });
    const state = buildLearningProgress(supplement, context, [
      { date: "2026-08-31", progress: lessons[10], textbook: null },
      { date: "2026-09-17", progress: "내신대비", textbook: null },
    ], "2026-09-18");
    expect(state.current).toBe(1);
    expect(state.currentBlock).toBe(lessons[10]);
    expect(state.currentDate).toBe("2026-08-31");
    expect(state.latestRecord?.date).toBe("2026-09-17");
    expect(state.currentIsLatest).toBe(false);
  });
  it("선택과목의 같은 단원명도 선택한 과정의 눈금에 놓인다", () => {
    const selected = planLearningGoal({ ...goal, studyGrade: "미적분Ⅱ", endStudyGrade: "미적분Ⅱ", startBlock: "정적분으로 정의된 함수", endBlock: flatLessons("미적분Ⅱ").at(-1)! });
    const state = buildLearningProgress(selected, context, [{ date: "2026-09-17", progress: "정적분으로 정의된 함수", textbook: null }], "2026-09-18");
    const ticks = learningTopicTicks(selected, state);
    const current = learningCurrentPosition(selected, state, ticks)!;
    expect(current).not.toBeNull();
    expect(ticks[current - 1]).toMatchObject({ grade: "미적분Ⅱ", lesson: "정적분으로 정의된 함수" });
  });
});
