import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LearningRails } from "./learning-rails";
import { flatLessons } from "@/features/onescreen/curriculum";
import { planLearningGoal, buildLearningProgress, type LearningGoal } from "../lib/learning-plan";

afterEach(cleanup);
const first = planLearningGoal({ studentId: "s", studyGrade: "중1", startBlock: flatLessons("중1")[0], endBlock: flatLessons("중1").at(-1)!, startDate: "2026-09-01", endDate: "2026-11-30", textbook: null, track: "regular" });
const progress = buildLearningProgress(first, { schedules: [], holidays: {}, spans: {} }, [], "2026-09-18");

describe("현재 진도와 고정 목표 수직선", () => {
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
