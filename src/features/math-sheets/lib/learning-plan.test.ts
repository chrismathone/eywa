import { describe, expect, it } from "vitest";
import { flatLessons } from "@/features/onescreen/curriculum";
import {
  buildLearningProgress,
  goalBlocks,
  learningDays,
  learningGoalError,
  learningStatusLabel,
  recordBlockIndex,
  type LearningContext,
  type LearningGoal,
} from "./learning-plan";

const blocks = flatLessons("중1");
const goal: LearningGoal = {
  studentId: "student",
  studyGrade: "중1",
  startBlock: blocks[0],
  endBlock: blocks[19],
  startDate: "2026-08-01",
  endDate: "2026-08-31",
  textbook: null,
};
const context: LearningContext = {
  schedules: ["mon", "thu"].map((dayOfWeek) => ({
    dayOfWeek,
    startTime: "16:00",
    endTime: "17:00",
    validFrom: null,
    validTo: null,
  })),
  spans: { student: [{ start: "2026-01-01", end: null }] },
  holidays: {},
};
const record = (date: string, index: number) => ({
  date,
  progress: blocks[index],
  textbook: null,
});

describe("전체 목표에서 수업일별 블록 배분", () => {
  it("목표의 시작·끝 블록을 포함하고 마지막 수업에 정확히 도달한다", () => {
    expect(goalBlocks(goal)).toHaveLength(20);
    const days = learningDays(goal, context);
    expect(days.map((d) => d.target)).toEqual([2, 4, 6, 8, 11, 13, 15, 17, 20]);
    expect(days.at(-1)).toEqual({
      date: "2026-08-31",
      target: 20,
      block: blocks[19],
    });
  });
  it("중복 교시는 하루로 합치고 휴강일과 수강 기간 밖 날짜를 제외한다", () => {
    const days = learningDays(goal, {
      ...context,
      schedules: [
        ...context.schedules,
        { ...context.schedules[0], startTime: "17:00" },
      ],
      holidays: { "2026-08-10": "휴강" },
      spans: { student: [{ start: "2026-08-06", end: "2026-08-20" }] },
    });
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-06",
      "2026-08-13",
      "2026-08-17",
      "2026-08-20",
    ]);
    expect(days.map((d) => d.target)).toEqual([5, 10, 15, 20]);
  });
  it("시간표 변경의 유효 기간을 날짜마다 반영한다", () => {
    const days = learningDays(goal, {
      ...context,
      schedules: [
        { ...context.schedules[0], validTo: "2026-08-14" },
        { ...context.schedules[1], validFrom: "2026-08-15" },
      ],
    });
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-20",
      "2026-08-27",
    ]);
  });
  it("분리 등원 학생은 해당 요일에만 목표를 배분한다", () => {
    const days = learningDays(goal, {
      ...context,
      spans: {
        student: [{ start: "2026-01-01", end: null, attendanceDays: ["thu"] }],
      },
    });
    expect(days.map((d) => d.date)).toEqual([
      "2026-08-06",
      "2026-08-13",
      "2026-08-20",
      "2026-08-27",
    ]);
    expect(days.at(-1)?.target).toBe(20);
  });
  it("월간·주간·일간은 모두 같은 누적 목표를 쓴다", () => {
    const p = buildLearningProgress(
      goal,
      context,
      [record("2026-08-13", 5)],
      "2026-08-13",
    );
    expect(p.month).toEqual({ from: 0, to: 20, endDate: "2026-08-31" });
    expect(p.week).toEqual({ from: 4, to: 8, endDate: "2026-08-16" });
    expect(p.target).toBe(8);
    expect(p.current).toBe(6);
    expect(p.remainingDays).toBe(5);
    expect(p.requiredPace).toBe(2.8);
    expect(learningStatusLabel(p)).toBe("2블록 느림");
  });
  it("아직 기록이 없는 학생은 0%나 뒤처짐으로 만들지 않는다", () => {
    const p = buildLearningProgress(goal, context, [], "2026-08-13");
    expect(p.status).toBe("no-data");
    expect(p.current).toBeNull();
    expect(p.percent).toBeNull();
    expect(p.requiredPace).toBeNull();
  });
  it("미래 기록과 목표 시작 전 기록은 현재 진도에 반영하지 않는다", () => {
    const p = buildLearningProgress(
      goal,
      context,
      [record("2026-07-31", 10), record("2026-08-20", 15)],
      "2026-08-13",
    );
    expect(p.current).toBeNull();
  });
  it("같은 날은 가장 뒤 블록, 날짜 간에는 가장 최근 위치를 쓴다", () => {
    const p = buildLearningProgress(
      goal,
      context,
      [
        record("2026-08-06", 12),
        {
          date: "2026-08-13",
          progress: `${blocks[8]}\n${blocks[5]}`,
          textbook: null,
        },
      ],
      "2026-08-13",
    );
    expect(p.current).toBe(9);
    expect(p.status).toBe("on");
  });
  it("시험 상태는 직전 진도를 지우지 않고 마지막 기록일을 표시한다", () => {
    const p = buildLearningProgress(
      goal,
      context,
      [
        record("2026-08-06", 12),
        { date: "2026-08-13", progress: "모의고사", textbook: null },
      ],
      "2026-08-13",
    );
    expect(p.current).toBe(13);
    expect(p.currentDate).toBe("2026-08-06");
    expect(p.status).toBe("ahead");
  });
  it("범위 이전은 0블록, 범위 이후는 전체 목표 완료로 제한한다", () => {
    const partial = { ...goal, startBlock: blocks[5], endBlock: blocks[9] };
    expect(
      buildLearningProgress(
        partial,
        context,
        [record("2026-08-13", 3)],
        "2026-08-13",
      ).current,
    ).toBe(0);
    const done = buildLearningProgress(
      partial,
      context,
      [record("2026-08-13", 15)],
      "2026-08-13",
    );
    expect(done.current).toBe(5);
    expect(done.percent).toBe(100);
    expect(done.status).toBe("done");
  });
  it("수업 시작 전과 수업 일정 없음은 별도 상태다", () => {
    expect(buildLearningProgress(goal, context, [], "2026-08-01").status).toBe(
      "not-started",
    );
    expect(
      buildLearningProgress(
        goal,
        { ...context, schedules: [] },
        [],
        "2026-08-13",
      ).status,
    ).toBe("no-schedule");
  });
  it("선택한 미래 월 계획은 오늘의 실제 진도와 독립적으로 계산한다", () => {
    const next = { ...goal, endDate: "2026-09-30" };
    const p = buildLearningProgress(
      next,
      context,
      [record("2026-08-13", 5)],
      "2026-08-13",
      "2026-09",
    );
    expect(p.month.endDate).toBe("2026-09-30");
    expect(p.month.to).toBe(20);
    expect(p.current).toBe(6);
  });
  it("잘못된 날짜·역순 블록·2년 초과 목표는 배분하지 않는다", () => {
    for (const patch of [
      { startDate: "2026-02-30" },
      { endDate: "2026-07-31" },
      { startBlock: blocks[20] },
      { endDate: "2030-01-01" },
      { studyGrade: "없는 과정" },
    ]) {
      expect(learningGoalError({ ...goal, ...patch })).not.toBeNull();
      expect(learningDays({ ...goal, ...patch }, context)).toEqual([]);
    }
  });
  it("고등 과정과 접두어가 붙은 기록도 같은 과정 안에서 찾는다", () => {
    const high = flatLessons("공통수학1");
    expect(high.length).toBeGreaterThan(0);
    expect(recordBlockIndex(`수학 ${blocks[4]}`, "중1")).toBe(4);
    expect(recordBlockIndex(high[3], "공통수학1")).toBe(3);
    expect(recordBlockIndex("프린트 문제풀이", "중1")).toBeNull();
  });
});
