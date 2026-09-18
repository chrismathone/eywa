import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LearningRails } from "./learning-rails";
import { flatLessons } from "@/features/onescreen/curriculum";
import { planLearningGoal, buildLearningProgress, type LearningGoal } from "../lib/learning-plan";
import { learningCurrentPosition, learningTopicTicks } from "../lib/learning-axis";
import { learningTopics } from "../lib/learning-path";

afterEach(cleanup);
const first = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: flatLessons("중1")[0], endBlock: flatLessons("중1").at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
const progress = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [], "2026-09-18");

describe("현재 진도와 고정 목표 수직선", () => {
  it("소수 블록에 있는 진도 점도 세부 단원 눈금에 정확히 놓인다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: flatLessons("중1")[0], textbook: null },
    ], "2026-09-18");
    const { container } = render(<LearningRails goal={first} progress={state} />);
    const ticks = container.querySelectorAll<HTMLElement>("[data-lesson]");
    expect(ticks).toHaveLength(learningTopics(first).length);
    expect(ticks[0]).toHaveStyle({ left: `${learningCurrentPosition(first, state)! * 100}%` });
    expect(ticks[0].style.left).toBe(container.querySelector('[data-planned]')?.getAttribute("style")?.match(/--current-position: ([^;]+)/)?.[1]);
  });
  it("파란 점은 키보드로도 날짜를 확인할 수 있고 클릭해도 학생 행이 열리지 않는다", async () => {
    const onSelect = vi.fn();
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: "수학 회전체", textbook: null },
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<div onClick={onSelect}><LearningRails goal={first} progress={state} /></div>);
    const marker = screen.getByRole("button", { name: "현재 진도 상세" });
    marker.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("기준 수업일 · 2026-08-31");
    expect(tooltip).not.toHaveTextContent("2026-09-14");
    expect(tooltip).toHaveTextContent("마지막 확인 진도");
    expect(marker).toHaveAccessibleDescription(expect.stringContaining("2026-08-31"));
    fireEvent.click(marker);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it("최신 내신대비와 목표 시작 전 마지막 확인 단원의 날짜를 함께 표시한다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: "수학 회전체", textbook: null },
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<LearningRails goal={first} progress={state} />);
    expect(screen.getByText("마지막 확인")).toBeVisible();
    expect(screen.getByText("중1 2학기, 회전체")).toBeVisible();
    expect(screen.getByText(/최근 발송 보고서 · 2026-09-14 수업/)).toHaveTextContent("진도선은 2026-08-31 마지막 확인 단원 기준");
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", String(learningCurrentPosition(first, state)));
  });
  it("단원 위치를 모르는 최신 발송 내용도 보이지만 진행률은 만들지 않는다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<LearningRails goal={first} progress={state} />);
    expect(screen.getByText("중1, 내신대비")).toBeVisible();
    expect(screen.getByText(/단원 위치 확인 필요/)).toBeVisible();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("목표 없는 학생도 발송 보고서의 최근 단원을 표시한다", () => {
    render(<LearningRails recentRecord={{ date: "2026-09-14", progress: "수학 회전체", textbook: null }} />);
    expect(screen.getByText("중1 2학기, 회전체")).toBeVisible();
    expect(screen.getByText(/최근 발송 보고서 · 2026-09-14 수업/)).toBeVisible();
  });
  it("보강 수업 횟수만 확인될 때는 차시 위치 확인이 필요하다고 표시한다", () => {
    const record = { date: "2026-09-14", progress: "수학 내신대비", textbook: null };
    render(<LearningRails goal={{ ...first, track: "supplement" }} progress={{ ...progress, current: 2, currentBlock: record.progress, latestRecord: record, currentIsLatest: true }} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByText(/단원 위치 확인 필요/)).toBeVisible();
  });
  it("첨부된 보강 목표는 16블록으로 뭉치지 않고 85개 차시와 이름을 모두 표시한다", () => {
    let goal = planLearningGoal({ ...first, track: "supplement", startBlock: "다각형", endBlock: "상대도수" });
    for (const [grade, lesson] of [["중2", "일차함수의 그래프와 연립방정식의 해"], ["중2", "확률의 계산"], ["중3", "이차함수의 최댓값과 최솟값"]]) {
      goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: lesson }, goal);
    }
    expect(goal.blockCount).toBe(16);
    const { container } = render(<LearningRails goal={goal} progress={{ ...progress, current: 2, currentBlock: "수학 다각형", currentDate: "2026-09-09" }} />);
    const ticks = container.querySelectorAll<HTMLElement>("[data-lesson]");
    expect(ticks).toHaveLength(85);
    expect(new Set([...ticks].map(tick => tick.style.left)).size).toBe(85);
    expect([...ticks].map(tick => tick.dataset.lesson)).toEqual(learningTopics(goal).map(topic => topic.lesson));
    expect(ticks[0]).toHaveAttribute("title", "중1 2학기, 다각형");
    expect(ticks[84]).toHaveAttribute("title", "중3 1학기, 이차함수의 최댓값과 최솟값");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(learningTopicTicks(goal)[0].position));
    expect(container.querySelector('[data-goal-number="4"]')).toHaveStyle({ left: "100%" });
  });
  it("오늘 계획이 3/4여도 유일한 빨간 목표는 수직선 끝에 둔다", () => {
    const { container } = render(<LearningRails goal={first} progress={{ ...progress, current: 6, target: 18 }} />);
    expect(screen.getByRole("img", { name: "목표진도" })).toHaveAccessibleDescription(expect.stringContaining("1차 목표"));
    expect(container.querySelector('[data-goal-number="1"]')).toHaveStyle({ left: "100%" });
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuemax", "1");
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", "0.25");
  });
  it("4차 목표는 1·2·3·4에 고정되고 계획일 변경에 움직이지 않는다", () => {
    let goal: LearningGoal = first;
    for (const grade of ["중2", "중3", "공통수학1"]) goal = planLearningGoal({ ...goal, endStudyGrade: grade, endBlock: flatLessons(grade).at(-1)! }, goal);
    const { container, rerender } = render(<LearningRails goal={goal} progress={{ ...progress, current: 12, target: 3 }} />);
    const positions = () => [...container.querySelectorAll<HTMLElement>('[data-goal-number]')].map(el => el.style.left);
    expect(positions()).toEqual(["25%", "50%", "75%", "100%"]);
    rerender(<LearningRails goal={goal} progress={{ ...progress, current: 12, target: 100 }} />);
    expect(positions()).toEqual(["25%", "50%", "75%", "100%"]);
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuemax", "4");
  });
});
