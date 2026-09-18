import { describe, expect, it } from "vitest";
import { learningAxisPosition, learningAxisTicks, learningCurrentPosition, learningTopicTicks } from "./learning-axis";
import { buildLearningProgress, planLearningGoal } from "./learning-plan";
import { learningTopics } from "./learning-path";
import { flatLessons } from "@/features/onescreen/curriculum";

describe("목표 단계 수직선", () => {
  it("한 목표는 끝이 1이고 그 안의 실제 진도는 소수다", () => {
    const stops = [{ blockCount: 24 }];
    expect(learningAxisPosition(6, stops)).toBe(0.25);
    expect(learningAxisPosition(24, stops)).toBe(1);
  });
  it("서로 다른 분량의 목표도 각각 한 칸을 차지한다", () => {
    const stops = [24, 72, 96, 120].map(blockCount => ({ blockCount }));
    expect([24, 72, 96, 120].map(block => learningAxisPosition(block, stops))).toEqual([1, 2, 3, 4]);
    expect(learningAxisPosition(48, stops)).toBe(1.5);
  });
  it("n차 목표를 추가해도 기존 현재 진도의 수직선 값은 유지된다", () => {
    const stops = [24, 48, 72, 96].map(blockCount => ({ blockCount }));
    expect(learningAxisPosition(36, stops)).toBe(1.5);
    expect(learningAxisPosition(36, [...stops, { blockCount: 120 }])).toBe(1.5);
    expect(learningAxisPosition(150, stops)).toBe(4);
    expect(learningAxisPosition(-1, stops)).toBe(0);
  });
});

describe("실제 블록 단위 눈금", () => {
  it("한 학기는 정확히 12칸이고 목표 끝은 1이다", () => {
    const ticks = learningAxisTicks([{ blockCount: 12 }]);
    expect(ticks).toHaveLength(12);
    expect(ticks[0]).toEqual({ block: 1, position: 1 / 12, goal: false });
    expect(ticks.at(-1)).toEqual({ block: 12, position: 1, goal: true });
  });
  it("1학기·2학기 분량의 목표를 각각 12칸·24칸으로 나눈다", () => {
    const stops = [{ blockCount: 12 }, { blockCount: 36 }];
    const ticks = learningAxisTicks(stops);
    expect(ticks.filter((tick) => tick.position <= 1)).toHaveLength(12);
    expect(ticks.filter((tick) => tick.position > 1)).toHaveLength(24);
    expect(ticks[12].position).toBe(1 + 1 / 24);
    for (const tick of ticks) expect(tick.position).toBe(learningAxisPosition(tick.block, stops));
  });
  it("복습 목표는 실제 4블록이며 미설정이면 눈금이 없다", () => {
    expect(learningAxisTicks([{ blockCount: 4 }])).toHaveLength(4);
    expect(learningAxisTicks([])).toEqual([]);
  });
});

describe("세부 단원 눈금과 현재 위치 일치", () => {
  const first = planLearningGoal({ studentId: "s", studyGrade: "중2", startBlock: "삼각형의 내심", endBlock: flatLessons("중2").at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null });
  const goal = planLearningGoal({ ...first, endStudyGrade: "공통수학1", endBlock: flatLessons("공통수학1").at(-1)! }, first);

  it("모든 과정의 모든 단원 위치에 눈금이 있고 블록 눈금 사이도 빠짐없이 표시한다", () => {
    const detail = learningTopicTicks(goal);
    const positions = new Set(detail.map((tick) => tick.position));
    expect(detail).toHaveLength(learningTopics(goal).length);
    expect(detail.some((tick) => Number.isInteger(tick.block))).toBe(true);
    expect(new Set(detail.map((tick) => tick.block)).size).toBe(detail.length);
    for (const topic of learningTopics(goal)) {
      const state = buildLearningProgress(goal, { schedules: [], holidays: {}, spans: {} }, [
        { date: "2026-08-31", progress: `${topic.grade} · ${topic.lesson}`, textbook: null },
      ], "2026-09-18");
      expect(state.current).not.toBeNull();
      expect(positions.has(learningCurrentPosition(goal, state)!), `${topic.grade} ${topic.lesson}`).toBe(true);
    }
  });
  it("목표를 확장해도 이전 단원의 수직선 위치는 바뀌지 않는다", () => {
    const later = learningTopicTicks(goal);
    for (const tick of learningTopicTicks(first)) expect(later).toContainEqual(tick);
  });
  it("복습·심화도 모든 차시를 표시하고 0.1블록보다 가까운 차시를 합치지 않는다", () => {
    const review = planLearningGoal({ ...first, studyGrade: "초1", endStudyGrade: "초3", startBlock: flatLessons("초1")[0], endBlock: flatLessons("초3").at(-1)!, track: "supplement" });
    const ticks = learningTopicTicks(review);
    expect(ticks).toHaveLength(learningTopics(review).length);
    expect(ticks.length).toBeGreaterThan(40);
    expect(new Set(ticks.map(tick => tick.position)).size).toBe(ticks.length);
    expect(ticks[1].block - ticks[0].block).toBeLessThan(0.1);
    expect(ticks.at(-1)?.position).toBe(1);
  });
  it("단원당 1블록인 옛 목표도 모든 차시를 표시한다", () => {
    const legacy = { ...first, blockCount: null, milestones: [] };
    expect(learningTopicTicks(legacy)).toHaveLength(learningTopics(legacy).length);
  });
  it("수업 횟수를 차시 위치로 사용하지 않고 확인 불가능한 차시는 추정하지 않는다", () => {
    const review = planLearningGoal({ ...first, track: "supplement" });
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [], "2026-09-18");
    expect(learningCurrentPosition(review, { ...state, current: 2, currentBlock: review.startBlock })).toBe(learningTopicTicks(review)[0].position);
    expect(learningCurrentPosition(review, { ...state, current: 2, currentBlock: "내신대비" })).toBeNull();
  });
});
