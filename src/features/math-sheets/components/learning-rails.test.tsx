import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningRails } from "./learning-rails";
import { flatLessons } from "@/features/onescreen/curriculum";
import { planLearningGoal, buildLearningProgress, type LearningGoal } from "../lib/learning-plan";
import { LEARNING_LESSON_WIDTH, learningCurrentPosition, learningGoalTicks, learningTargetPosition, learningTopicTicks } from "../lib/learning-axis";

afterEach(cleanup);
const first = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: flatLessons("중1")[0], endBlock: flatLessons("중1").at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
const progress = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [], "2026-09-18");

describe("현재 진도와 고정 목표 수직선", () => {
  it("편집 가능한 목표 점과 목표 라벨은 해당 목표 편집을 열고 행 선택으로 전파하지 않는다", () => {
    const edit = vi.fn(), select = vi.fn(), row = vi.fn();
    render(<div onClick={row}><LearningRails goal={first} progress={progress} onEditGoal={edit} onSelectPosition={select} /></div>);
    fireEvent.click(screen.getByRole("button", { name: "1차 목표" }));
    fireEvent.click(screen.getByRole("button", { name: "1차 목표 남은 계획 수정" }));
    expect(edit.mock.calls).toEqual([[1], [1]]);
    expect(select).not.toHaveBeenCalled(); expect(row).not.toHaveBeenCalled();
  });
  it("같은 학기에 목표가 둘 있어도 모든 목표 점과 동작을 보존한다", () => {
    const onSelect = vi.fn();
    const goal = planLearningGoal({ ...first, track: "supplement", startBlock: "다각형", endBlock: "부채꼴의 호의 길이와 넓이" });
    const extended = planLearningGoal({ ...goal, endBlock: "상대도수" }, goal);
    const state = { ...progress, currentBlock: "수학 다각형" };
    render(<LearningRails goal={extended} progress={state} onSelectPosition={onSelect} />);
    expect(screen.getByRole("button", { name: "1차 목표" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2차 목표" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1차 목표" }));
    expect(onSelect).toHaveBeenCalledWith(expect.any(Number), goal.endDate, "goal");
  });
  it("소수 블록에 있는 진도 점도 세부 단원 눈금에 정확히 놓인다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: flatLessons("중1")[0], textbook: null },
    ], "2026-09-18");
    const { container } = render(<LearningRails goal={first} progress={state} />);
    const ticks = container.querySelectorAll<HTMLElement>("[data-lesson]");
    expect(ticks).toHaveLength(learningTopicTicks(first, state).length);
    const currentTick = [...ticks].find(tick => tick.dataset.lesson === flatLessons("중1")[0])!;
    expect(currentTick).toHaveStyle({ left: `${learningCurrentPosition(first, state)! / ticks.length * 100}%` });
    expect(currentTick.style.left).toBe(container.querySelector('[data-planned]')?.getAttribute("style")?.match(/--current-position: ([^;]+)/)?.[1]);
  });
  it("파란 점은 키보드로도 날짜를 확인할 수 있고 클릭해도 학생 행이 열리지 않는다", async () => {
    const onSelect = vi.fn();
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: "수학 회전체", textbook: null },
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<div onClick={onSelect}><LearningRails goal={first} progress={state} /></div>);
    const marker = screen.getByRole("button", { name: "현재 진도 상세" });
    act(() => marker.focus());
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("기준 수업일 · 2026-08-31");
    expect(tooltip.querySelector("small")).not.toHaveTextContent("2026-09-14");
    expect(tooltip).toHaveTextContent("최근 발송 보고서 · 2026-09-14 수업");
    expect(tooltip).toHaveTextContent("마지막 확인 진도");
    expect(marker).toHaveAccessibleDescription(expect.stringContaining("2026-08-31"));
    fireEvent.click(marker);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("최근 발송 설명은 본문에서 제거하고 현재 진도에 마우스를 올리면 확인한다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: "수학 회전체", textbook: null },
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<LearningRails goal={first} progress={state} />);
    expect(screen.getByText("마지막 확인")).toBeVisible();
    expect(screen.getByText("중1 2학기, 회전체")).toBeVisible();
    expect(screen.queryByText(/최근 발송 보고서 · 2026-09-14 수업/)).not.toBeInTheDocument();
    expect(screen.getByTitle(/최근 발송 보고서 · 2026-09-14 수업/)).toHaveAttribute("title", expect.stringContaining("진도선은 2026-08-31 마지막 확인 단원 기준"));
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", String(learningCurrentPosition(first, state)));
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAccessibleDescription(expect.stringContaining("차시"));
  });
  it("단원 위치를 모르는 최신 발송 내용도 보이지만 진행률은 만들지 않는다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<LearningRails goal={first} progress={state} />);
    expect(screen.getByText("중1, 내신대비")).toBeVisible();
    expect(screen.getByTitle(/단원 위치 확인 필요/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("목표 없는 학생도 발송 보고서의 최근 단원을 표시한다", () => {
    render(<LearningRails recentRecord={{ date: "2026-09-14", progress: "수학 회전체", textbook: null }} />);
    expect(screen.getByText("중1 2학기, 회전체")).toBeVisible();
    expect(screen.getByTitle(/최근 발송 보고서 · 2026-09-14 수업/)).toBeVisible();
  });
  it("보강 수업 횟수만 확인될 때는 차시 위치 확인이 필요하다고 표시한다", () => {
    const record = { date: "2026-09-14", progress: "수학 내신대비", textbook: null };
    render(<LearningRails goal={{ ...first, track: "supplement" }} progress={{ ...progress, current: 2, currentBlock: record.progress, latestRecord: record, currentIsLatest: true }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByTitle(/단원 위치 확인 필요/)).toBeVisible();
  });
  it("보강 목표도 이전 2학기부터 이후 4학기의 모든 차시를 표시한다", () => {
    let goal = planLearningGoal({ ...first, track: "supplement", startBlock: "다각형", endBlock: "상대도수" });
    for (const [grade, lesson] of [["중2", "일차함수의 그래프와 연립방정식의 해"], ["중2", "확률의 계산"], ["중3", "이차함수의 최댓값과 최솟값"]]) {
      goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: lesson }, goal);
    }
    expect(goal.blockCount).toBe(16);
    const state = { ...progress, current: 2, currentBlock: "수학 다각형", currentDate: "2026-09-09" };
    const topics = learningTopicTicks(goal, state);
    const { container } = render(<LearningRails goal={goal} progress={state} />);
    const ticks = container.querySelectorAll<HTMLElement>("[data-lesson]");
    expect(ticks).toHaveLength(topics.length);
    expect(new Set([...ticks].map(tick => tick.style.left)).size).toBe(topics.length);
    expect([...ticks].map(tick => tick.dataset.lesson)).toEqual(topics.map(topic => topic.lesson));
    expect(container.querySelector('[data-lesson="다각형"]')).toHaveAttribute("title", "중1 2학기, 다각형");
    expect(ticks[ticks.length - 1]).toHaveAttribute("title", "중3 1학기, 이차함수의 최댓값과 최솟값");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(learningCurrentPosition(goal, state)));
    expect(container.querySelectorAll('[data-goal-number]')).toHaveLength(4);
    expect(container.querySelector('[data-goal-number="4"]')).toHaveStyle({ left: "100%" });
  });
  it("저장된 목표가 없는 학기는 완료일을 추정하지 않는다", () => {
    render(<LearningRails goal={first} progress={progress} />);
    expect(screen.getByRole("img", { name: "목표진도" })).not.toHaveAccessibleDescription(expect.stringContaining("완료일 미설정"));
    expect(screen.getAllByRole("button", { name: /차 목표$/ })).toHaveLength(1);
    const scale = screen.getByLabelText("목표 수직선 눈금");
    expect(scale).toHaveTextContent("중1 1학기");
    expect(scale).toHaveTextContent("중1 2학기");
    expect(scale).not.toHaveTextContent(/[1-6]차/);
    expect(screen.getByRole("img", { name: "목표진도" })).toHaveAccessibleDescription(expect.stringContaining(first.endDate));
  });
  it("화면 공통 배율을 사용해도 목표와 현재의 차시 위치는 유지된다", () => {
    let goal: LearningGoal = first;
    for (const grade of ["중2", "중3", "공통수학1"]) goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: flatLessons(grade).at(-1)! }, goal);
    const state = { ...progress, current: 12, target: 3, currentBlock: "수학 다각형" };
    const topics = learningTopicTicks(goal, state);
    const stops = learningGoalTicks(goal, topics);
    const { container, rerender } = render(<LearningRails goal={goal} progress={state} scaleLessons={250} />);
    const positions = () => [...container.querySelectorAll<HTMLElement>('[data-goal-number]')].map(el => el.style.left);
    const expected = stops.filter(stop => stop.hasGoal).map(stop => `${stop.position / topics.length * 100}%`);
    expect(positions()).toEqual(expected);
    expect(container.querySelector('[data-planned]')).toHaveStyle({ "--lesson-count": String(topics.length), "--scale-lessons": "250", "--lesson-max-width": `${LEARNING_LESSON_WIDTH}px` });
    rerender(<LearningRails goal={goal} progress={{ ...state, target: 100 }} scaleLessons={200} />);
    expect(positions()).toEqual(expected);
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuemax", String(topics.length));
  });
  it("장기 계획의 모든 정거장을 보존하고 표시 숫자는 차시 눈금과 일치한다", () => {
    let goal: LearningGoal = first;
    for (const grade of ["중2", "중3", "공통수학1", "공통수학2"]) {
      goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: flatLessons(grade).at(-1)! }, goal);
    }
    const state = { ...progress, current: 9.5, currentBlock: "수학 다각형" };
    const { container } = render(<LearningRails goal={goal} progress={state} />);
    expect(container.querySelectorAll("[data-goal-number]")).toHaveLength(5);
    expect(screen.getByText(String(learningCurrentPosition(goal, state)))).toBeInTheDocument();
    expect(screen.getByText(String(learningTargetPosition(goal, learningTopicTicks(goal, state))))).toBeInTheDocument();
    expect(screen.getByText("차시 목표")).toBeInTheDocument();
  });
});
