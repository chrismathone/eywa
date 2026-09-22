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
    expect(history.lessons.find(item => item.lesson === lessons[11])).toMatchObject({ date: "2026-07-23", estimated: true });
    expect(history.lessons.find(item => item.lesson === lessons[15])).toMatchObject({ date: "2026-07-23", estimated: false });
    expect(history.lessons.every(item => item.date >= "2026-07-09" && item.date <= "2026-09-18")).toBe(true);
    expect(history.lessons.every(item => records.some(record => record.date === item.date))).toBe(true);
  });
  it("빈 차시는 시험 보고서가 발송된 수업일에도 배분하되 발송 시각이나 보고서 없는 평일로 옮기지 않는다", () => {
    const reported = [
      { date: "2026-07-13", progress: lessons[10], textbook: null, sentAt: "2026-07-14T01:00:00Z" },
      { date: "2026-07-16", progress: "내신대비", textbook: null },
      { date: "2026-07-23", progress: lessons[15], textbook: null },
      { date: "2026-10-01", progress: lessons[19], textbook: null },
    ];
    const history = buildLearningHistory(goal, base, reported, "2026-07-01", "2026-09-18");
    expect(history.lessons.find(item => item.lesson === lessons[11])).toMatchObject({ date: "2026-07-16", estimated: true });
    expect(new Set(history.lessons.map(item => item.date))).toEqual(new Set(["2026-07-13", "2026-07-16", "2026-07-23"]));
  });
  it("오래 재원한 학생도 날짜는 최근 1년으로 제한하고 윤년 날짜를 보정한다", () => {
    const history = buildLearningHistory(goal, base, records, "2020-01-01", "2026-09-18");
    expect(history.fromDate).toBe("2025-09-18");
    expect(buildLearningHistory(goal, base, [], "2020-01-01", "2024-02-29").fromDate).toBe("2023-02-28");
  });
  it("오래 재원한 학생도 기록이 처음 닿은 차시부터 선을 그린다 — 앞 두 학기를 억지로 칠하지 않는다(원장 2026-09-21)", () => {
    // 김민찬 모양: 2020 등록인데 보고서는 최근 몇 달뿐 — 예전엔 시작점을 '모름'으로 두어 현재 학기 두 학기 앞부터 찼다.
    const history = buildLearningHistory(goal, base, records, "2020-01-01", "2026-09-18");
    expect(history.start?.lesson).toBe(lessons[0]);
    const ticks = learningTopicTicks(goal, { ...base, history });
    expect(ticks[0].lesson).toBe(lessons[0]);
    expect(ticks.length).toBeLessThan(learningTopicTicks(goal, base).length);
    // 기록이 하나도 없으면 목표 시작 차시에서 시작한다(모르는 앞부분을 그리지 않는다).
    const empty = buildLearningHistory(goal, { ...base, currentBlock: null }, [], "2020-01-01", "2026-09-18");
    expect(empty.start?.lesson).toBe(goal.startBlock);
  });
  it("첫 기록이 목표 시작보다 뒤면 목표 시작이 아니라 첫 기록에서 선을 자른다", () => {
    // 목표는 lessons[0]부터지만 1년 안 첫 기록은 07-13 lessons[10] — '목표 시작부터'로 잘못 구현하면 여기서 걸린다.
    const later = records.slice(1);
    const progress = buildLearningProgress(goal, context, later, "2026-09-18");
    const history = buildLearningHistory(goal, progress, later, "2020-01-01", "2026-09-18");
    expect(history.start?.lesson).toBe(lessons[10]);
    expect(learningTopicTicks(goal, { ...progress, history })[0].lesson).toBe(lessons[10]);
  });
  it("계획 위치가 첫 기록보다 앞이어도 계획 대비 차이·상태는 자르지 않은 위치로 센다(적대 리뷰 2026-09-21)", () => {
    const one = [{ date: "2026-09-17", progress: lessons[40], textbook: null }];
    const progress = buildLearningProgress(goal, context, one, "2026-09-18");
    const cut = { ...progress, history: buildLearningHistory(goal, progress, one, "2020-01-01", "2026-09-18") };
    const whole = { ...progress, history: { ...cut.history, start: null } };
    const now = learningRailMetrics(goal, cut), before = learningRailMetrics(goal, whole);
    expect(now.current).toBe(1);
    expect(now.target).toBe(0);
    expect(now.targetBeforeRail).toBe(true);
    expect(before.targetBeforeRail).toBe(false);
    expect(now.difference).toBe(before.difference);
    expect(now.difference).toBeGreaterThan(1);
    expect(now.status).toBe("ahead");
    expect(now.requiredPace).toBe(before.requiredPace);
  });
  it("첫 기록이 이미 목표 끝을 지났으면 목표 구간을 레일에 남겨(목표 시작부터) 완료 100%로 본다", () => {
    const short = planLearningGoal({ ...goal, startBlock: lessons[0], endBlock: lessons[5], startDate: "2026-03-01", endDate: "2026-08-31" });
    for (const first of [lessons[12], lessons[6]]) {
      const reports = [
        { date: "2026-09-10", progress: first, textbook: null },
        { date: "2026-09-17", progress: lessons[14], textbook: null },
      ];
      const progress = buildLearningProgress(short, context, reports, "2026-09-18");
      const history = buildLearningHistory(short, progress, reports, "2020-01-01", "2026-09-18");
      expect(history.start?.lesson).toBe(lessons[0]);
      // 목표가 0차시('3 / 0차시')도, 분모가 1이라 1000%도 아니다.
      expect(learningRailMetrics(short, { ...progress, history })).toMatchObject({ total: 6, status: "done", percent: 100 });
    }
  });
  it("목표 끝 단원을 교과에서 못 찾으면 완료로 둔갑하지 않는다", () => {
    const unknown = { ...goal, endBlock: "교과에 없는 단원" };
    const progress = buildLearningProgress(goal, context, records, "2026-09-18");
    const history = buildLearningHistory(unknown, progress, records, "2020-01-01", "2026-09-18");
    const summary = learningRailMetrics(unknown, { ...progress, history });
    expect(summary.status).not.toBe("done");
    expect(summary.percent).not.toBe(100);
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
      remainingDays: 2, requiredPace: 3, status: "on", targetBeforeRail: false,
    });
    // 진도율은 100에서 자른다(2026-09-21 재리뷰 — 레일 시작이 목표 끝 가까이로 밀리면 분모가 작아져 1000%가 나왔다). 종전 핀 108.
    expect(learningRailMetrics(short, { ...state, currentBlock: lessons[20] })).toMatchObject({
      current: 13, total: 12, percent: 100, requiredPace: 0, status: "done",
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
