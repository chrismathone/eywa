import { describe, expect, it } from "vitest";
import { flatLessons, curriculumForGradeSemester } from "@/features/onescreen/curriculum";
import {
  buildLearningProgress,
  goalBlocks,
  learningDays,
  learningBlocks,
  plannedAt,
  standardGoalDates,
  learningGoalError,
  learningStatusLabel,
  recordBlockIndex,
  normalizeLearningGoal,
  planLearningGoal,
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

describe("반별 정규 12블록과 복습 심화 4블록", () => {
  const topics = curriculumForGradeSemester("중1", 1).flatMap((unit) => unit.lessons);
  const regular: LearningGoal = {
    ...goal, track: "regular", blockCount: 12,
    startBlock: topics[0], endBlock: topics.at(-1)!,
    ...standardGoalDates("2026-09", "regular"),
  };
  const mixed: LearningContext = {
    ...context,
    schedules: [...context.schedules, { ...context.schedules[0], dayOfWeek: "wed" }],
    holidays: { "2026-09-24": "추석" },
  };
  const review: LearningGoal = {
    ...regular, track: "supplement", blockCount: 4,
    ...standardGoalDates("2026-09", "supplement"),
    startBlock: topics[0], endBlock: topics[0],
  };

  it("한 학기는 기존 단원 수와 무관하게 12블록이며 원본 단원은 보존한다", () => {
    expect(learningBlocks(regular)).toHaveLength(12);
    expect(goalBlocks(regular)).toEqual(topics);
    expect(learningBlocks(regular)[0]).toContain(topics[0]);
    expect(learningBlocks(regular).at(-1)).toContain(topics.at(-1));
    expect(regular.endDate).toBe("2026-11-30");
    expect(standardGoalDates("2026-12", "regular").endDate).toBe("2027-02-28");
  });
  it("휴강과 달별 수업 횟수가 달라도 월 목표는 4·8·12블록이다", () => {
    const days = learningDays(regular, mixed);
    expect(plannedAt(days, "2026-09-30")).toBe(4);
    expect(plannedAt(days, "2026-10-31")).toBe(8);
    expect(plannedAt(days, "2026-11-30")).toBe(12);
    expect(days.some((day) => new Date(`${day.date}T00:00:00Z`).getUTCDay() === 3)).toBe(true);
    expect(days.some((day) => day.date === "2026-09-24")).toBe(false);
  });
  it("정규 반에서는 수요일 기록도 같은 정규 진도로 반영한다", () => {
    const monday = { date: "2026-09-14", progress: topics[12], textbook: null };
    const p = buildLearningProgress(regular, mixed, [monday, { ...monday, date: "2026-09-16", progress: topics[0] }], "2026-09-17");
    expect(p.current).toBe(Math.round(1 / topics.length * 12 * 10) / 10);
    expect(p.currentBlock).toBe(topics[0]);
    expect(p.currentDate).toBe("2026-09-16");
    expect(p.total).toBe(12);
  });
  it("마지막 단원에 도달하면 정확히 12블록·100%가 된다", () => {
    const p = buildLearningProgress(regular, mixed, [{ date: "2026-09-17", progress: topics.at(-1)!, textbook: null }], "2026-09-17");
    expect(p.current).toBe(12);
    expect(p.percent).toBe(100);
    expect(p.status).toBe("done");
  });
  it("복습 심화 반은 요일과 무관하게 월 4블록이며 같은 단원도 날짜별로 누적한다", () => {
    const days = learningDays(review, mixed);
    expect(days.some((day) => new Date(`${day.date}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    expect(days.at(-1)?.target).toBe(4);
    const records = ["2026-09-02", "2026-09-09", "2026-09-14", "2026-09-16", "2026-09-16", "2026-09-23"].map((date) => ({ date, progress: topics[0], textbook: null }));
    const p = buildLearningProgress(review, mixed, records, "2026-09-17");
    expect(p.current).toBe(4); // All class days count, duplicate/future reports do not.
    expect(p.total).toBe(4);
    expect(p.currentBlock).toBe(topics[0]);
  });
  it("보조수업은 전월·목표 종료 후·휴강일·빈 진도 기록을 세지 않는다", () => {
    const p = buildLearningProgress(review, { ...mixed, holidays: { "2026-09-09": "휴강" } }, [
      { date: "2026-08-26", progress: topics[0], textbook: null },
      { date: "2026-09-02", progress: "", textbook: null },
      { date: "2026-09-09", progress: topics[0], textbook: null },
      { date: "2026-10-07", progress: topics[0], textbook: null },
    ], "2026-10-08");
    expect(p.current).toBeNull();
    expect(p.percent).toBeNull();
  });
  it("수업 없는 달을 몰래 완료 처리하거나 다른 달에 떠넘기지 않는다", () => {
    expect(learningDays(regular, { ...mixed, spans: { student: [{ start: "2026-09-01", end: "2026-10-31" }] } })).toEqual([]);
  });
  it("12블록의 수·3개월 기간·학기 경계를 서버에서도 검증할 수 있다", () => {
    for (const patch of [
      { blockCount: 24 }, { startDate: "2026-09-02" }, { endDate: "2026-12-31" }, { endBlock: blocks.at(-1)! },
    ]) expect(learningGoalError({ ...regular, ...patch })).not.toBeNull();
    expect(learningGoalError(regular)).toBeNull();
    expect(learningGoalError(review)).toBeNull();
  });
  it("기존 24블록 정거장을 날짜와 수정 버전을 보존해 한 번만 환산한다", () => {
    const first = planLearningGoal(regular);
    const next = { ...planLearningGoal({ ...first, endBlock: blocks.at(-1)! }, first), updatedAt: "version" };
    const legacy = { ...next, blockCount: next.blockCount! * 2,
      milestones: next.milestones!.map((stop) => ({ ...stop, blockCount: stop.blockCount * 2 })) };
    const normalized = normalizeLearningGoal(legacy);
    expect(normalized).toEqual(next);
    expect(normalizeLearningGoal(normalized)).toBe(normalized);
    expect(learningGoalError(normalized)).toBeNull();
    expect(learningDays(normalized, mixed).at(-1)?.target).toBe(24);
    expect(legacy.blockCount).toBe(48);
    const extension = planLearningGoal({ ...normalized, endStudyGrade: "중2", endBlock: flatLessons("중2").at(-1)! }, legacy);
    expect(extension.milestones?.slice(0, 2)).toEqual(normalized.milestones);
    expect(learningGoalError(extension)).toBeNull();
  });
  it("새 24블록·6개월 계획과 복습 목표, 비표준 옛 목표는 다시 나누지 않는다", () => {
    const year = planLearningGoal({ ...regular, endBlock: blocks.at(-1)! });
    expect(year.blockCount).toBe(24);
    expect(normalizeLearningGoal(year)).toBe(year);
    expect(normalizeLearningGoal(review)).toBe(review);
    expect(normalizeLearningGoal(goal)).toBe(goal);
  });
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
  it("목표 시작 전 마지막 진도를 이어받고 미래 기록은 반영하지 않는다", () => {
    const p = buildLearningProgress(
      goal,
      context,
      [record("2026-07-31", 10), record("2026-08-20", 15)],
      "2026-08-13",
    );
    expect(p.current).toBe(11);
    expect(p.currentDate).toBe("2026-07-31");
    expect(p.latestRecord?.date).toBe("2026-07-31");
    expect(p.currentIsLatest).toBe(true);
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
    expect(p.latestRecord?.progress).toBe("모의고사");
    expect(p.currentIsLatest).toBe(false);
    expect(p.status).toBe("ahead");
  });
  it("같은 수업일에는 늦게 발송된 보고서가 현재 진도이고 늦게 보낸 과거 수업이 덮지 않는다", () => {
    const newer = { ...record("2026-08-13", 5), sentAt: "2026-08-14T11:00:00Z" };
    const p = buildLearningProgress(goal, context, [
      newer,
      { ...record("2026-08-13", 12), sentAt: "2026-08-14T10:00:00Z" },
      { ...record("2026-08-06", 19), sentAt: "2026-08-15T10:00:00Z" },
    ], "2026-08-15");
    expect(p.current).toBe(6);
    expect(p.latestRecord).toEqual(newer);
    expect(p.currentIsLatest).toBe(true);
  });
  it("같은 날 뒤늦게 발송한 내신대비도 마지막 단원과 구별한다", () => {
    const p = buildLearningProgress(goal, context, [
      { ...record("2026-08-13", 5), sentAt: "2026-08-14T10:00:00Z" },
      { ...record("2026-08-13", 0), progress: "수학 내신대비", sentAt: "2026-08-14T11:00:00Z" },
    ], "2026-08-15");
    expect(p.current).toBe(6);
    expect(p.currentIsLatest).toBe(false);
    expect(p.latestRecord?.progress).toBe("수학 내신대비");
  });
  it("알려진 단원이 전혀 없으면 최신 발송 내용만 표시하고 블록을 추정하지 않는다", () => {
    const p = buildLearningProgress(goal, context, [{ ...record("2026-08-13", 0), progress: "수학 내신대비" }], "2026-08-15");
    expect(p.current).toBeNull();
    expect(p.latestRecord?.progress).toBe("수학 내신대비");
    expect(p.status).toBe("no-data");
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
