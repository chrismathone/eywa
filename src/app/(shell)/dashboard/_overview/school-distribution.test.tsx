import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SchoolDistribution } from "./school-distribution";
import { DASHBOARD_SUBJECT_COLORS as C } from "@/features/dashboard/overview/subject-colors";

afterEach(cleanup);
it("학교 목록과 전체 보기 팝업이 같은 수강 구성과 색을 보여준다", async () => {
  const schools = Array.from({ length: 6 }, (_, i) => ({ label: `학교${i}`, value: 5,
    subjects: { englishOnly: 1, both: 1, mathOnly: 1, otherOnly: 1, noEnrollment: 1 },
  }));
  render(<SchoolDistribution groups={[{ label: "초등", total: 30, schools }]} />);
  expect(screen.getByRole("img", { name: "학교0 영어만 1명" })).toHaveStyle({ background: C.english });
  expect(screen.getByRole("img", { name: "학교0 동시수강 1명" })).toHaveStyle({ background: C.both });
  expect(screen.getByRole("img", { name: "학교0 수학만 1명" })).toHaveStyle({ background: C.math });
  expect(screen.getByRole("img", { name: "학교0 미수강 1명" })).toHaveStyle({ background: C.unenrolled });
  expect(screen.queryByText("학교5")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "초등 학교별 학생 자세히 보기" }));
  const popup = await screen.findByRole("dialog");
  expect(within(popup).getByRole("img", { name: "학교5 동시수강 1명" })).toHaveStyle({ background: C.both });
  expect(within(popup).getAllByRole("img")).toHaveLength(30);
});

it("과거 스냅샷의 합계만으로 수강과목을 지어내지 않는다", () => {
  render(<SchoolDistribution groups={[{ label: "초등", total: 2, schools: [{ label: "학교", value: 2 }] }]} />);
  expect(screen.getByRole("img", { name: "학교 전체 2명" })).toHaveStyle({ background: C.other });
  expect(screen.queryByRole("img", { name: /미수강/ })).toBeNull();
});
