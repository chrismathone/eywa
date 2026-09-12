import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LevelSplitChart } from "./level-split";
import { GradeSplitChart } from "./grade-split";
import { DASHBOARD_SUBJECT_COLORS as C } from "@/features/dashboard/overview/subject-colors";
afterEach(cleanup);

it("급별 세 조각과 별도의 미수강 막대가 전체 인원을 보존한다", () => {
  const split = { rows: [{ label: "초등", englishOnly: 2, both: 3, mathOnly: 4, neither: 2, total: 11 }] };
  const { container } = render(<LevelSplitChart split={split} noEnrollment={1} />);
  expect(screen.getByRole("img", { name: "초등 영어만 2명" })).toHaveStyle({ background: C.english });
  expect(screen.getByRole("img", { name: "초등 영어+수학 3명" })).toHaveStyle({ background: C.both });
  expect(screen.getByRole("img", { name: "초등 수학만 4명" })).toHaveStyle({ background: C.math });
  expect(screen.getByRole("img", { name: "기타 과목 재원생 1명" })).toBeTruthy();
  expect(screen.getByRole("img", { name: "미수강 재원생 1명" })).toHaveStyle({ background: C.unenrolled });
  expect(container.textContent).toContain("전체 재원생11명");
  expect([...container.querySelectorAll('[role="img"]')].at(-1)?.getAttribute("aria-label")).toBe("미수강 재원생 1명");
});

it("학년별도 실제 미수강과 기타 과목만 수강을 혼동하지 않는다", () => {
  render(<GradeSplitChart split={{ rows: [], neither: 3 }} noEnrollment={2} />);
  expect(screen.getByRole("img", { name: "미수강 재원생 2명" })).toHaveStyle({ background: C.unenrolled });
  expect(screen.getByRole("img", { name: "기타 과목 재원생 1명" })).toBeTruthy();
  expect(screen.queryByText(/모두 없는 재원생/)).toBeNull();
});
