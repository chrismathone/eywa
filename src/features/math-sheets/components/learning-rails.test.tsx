import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LearningRails } from "./learning-rails";
import { flatLessons } from "@/features/onescreen/curriculum";
import { planLearningGoal, buildLearningProgress, type LearningGoal } from "../lib/learning-plan";

afterEach(cleanup);
const first = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: flatLessons("중1")[0], endBlock: flatLessons("중1").at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
const progress = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [], "2026-09-18");

describe("현재 진도와 고정 목표 수직선", () => {
  it("최신 내신대비와 목표 시작 전 마지막 확인 단원의 날짜를 함께 표시한다", () => {
    const state = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [
      { date: "2026-08-31", progress: "수학 회전체", textbook: null },
      { date: "2026-09-14", progress: "수학 내신대비", textbook: null },
    ], "2026-09-18");
    render(<LearningRails goal={first} progress={state} />);
    expect(screen.getByText("마지막 확인")).toBeVisible();
    expect(screen.getByText("중1 2학기, 회전체")).toBeVisible();
    expect(screen.getByText(/최근 발송 보고서 · 2026-09-14 수업/)).toHaveTextContent("진도선은 2026-08-31 마지막 확인 단원 기준");
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", String(state.current! / state.total));
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
