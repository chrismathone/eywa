import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { GradeSplitChart } from "./grade-split";
import { StudentSubjectBars } from "./student-subject-bars";
import { SchoolDistribution } from "./school-distribution";

afterEach(cleanup);

const subjects = { englishOnly: 2, both: 3, mathOnly: 4, otherOnly: 0, noEnrollment: 0 };
const row = { label: "초등", ...subjects, neither: 0, total: 9 };
const charts = [
  { name: "학년", chart: () => <GradeSplitChart split={{ rows: [row], neither: 0 }} /> },
  // 급별(재원생 구성)은 2026-09-28부터 조각이 원생목록 링크다 — level-split.test.tsx가 잠근다.
  { name: "학교·신규생 단계", chart: () => <StudentSubjectBars rows={[{ label: row.label, value: 9, subjects }]} /> },
];

for (const chart of charts) {
  it.each(["영어만", "동시수강", "수학만"])(`${chart.name}: %s 조각을 누르면 세 구성의 인원을 함께 보여준다`, async (segment) => {
    render(chart.chart());
    const images = within(screen.getByRole("button", { name: "초등 수강 구성 보기" })).getAllByRole("img");
    // The middle segment is called 영어+수학 in grade/level and 동시수강 in school/stage charts.
    const index = segment === "영어만" ? 0 : segment === "수학만" ? 2 : 1;
    fireEvent.click(images[index]);
    const popup = await screen.findByRole("dialog", { name: "초등 수강 구성" });
    expect(within(popup).getByText("영어만").parentElement).toHaveTextContent("영어만2명");
    expect(within(popup).getByText("동시수강").parentElement).toHaveTextContent("동시수강3명");
    expect(within(popup).getByText("수학만").parentElement).toHaveTextContent("수학만4명");
    fireEvent.click(within(popup).getByRole("button", { name: "수강 구성 닫기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
}

it("0명도 표시하고 열린 팝업에 갱신된 인원이 반영된다", async () => {
  const renderChart = (both: number) => <StudentSubjectBars rows={[{
    label: "등록 완료", value: both + 2,
    subjects: { englishOnly: 0, both, mathOnly: 0, otherOnly: 1, noEnrollment: 1 },
  }]} />;
  const { rerender } = render(renderChart(1));
  fireEvent.click(screen.getByRole("button", { name: "등록 완료 수강 구성 보기" }));
  const popup = await screen.findByRole("dialog");
  expect(within(popup).getAllByText("0")).toHaveLength(2);
  expect(within(popup).getByText("기타 과목").parentElement).toHaveTextContent("1명");
  expect(within(popup).getByText("미수강").parentElement).toHaveTextContent("1명");
  rerender(renderChart(7));
  expect(within(popup).getByText("동시수강").parentElement).toHaveTextContent("7명");
  fireEvent.keyDown(popup, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("학교 전체 보기 안에서도 열리고 구성만 닫으면 학교 목록이 유지된다", async () => {
  render(<SchoolDistribution groups={[{ label: "초등", total: 54,
    schools: Array.from({ length: 6 }, (_, index) => ({ label: `학교${index}`, value: 9, subjects })),
  }]} />);
  fireEvent.click(screen.getByRole("button", { name: "초등 학교별 학생 자세히 보기" }));
  const schoolPopup = await screen.findByRole("dialog", { name: "초등 학교별 학생" });
  fireEvent.click(within(schoolPopup).getByRole("button", { name: "학교5 수강 구성 보기" }));
  const subjectPopup = await screen.findByRole("dialog", { name: "학교5 수강 구성" });
  expect(within(subjectPopup).getByText("동시수강").parentElement).toHaveTextContent("3명");
  fireEvent.keyDown(subjectPopup, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "학교5 수강 구성" })).toBeNull());
  expect(screen.getByRole("dialog", { name: "초등 학교별 학생" })).toBeVisible();
});

it("수강 구성 없는 과거 스냅샷은 인원을 지어내는 팝업을 만들지 않는다", () => {
  render(<StudentSubjectBars rows={[{ label: "학교", value: 5 }]} />);
  expect(screen.queryByRole("button", { name: "학교 수강 구성 보기" })).toBeNull();
  expect(screen.getByRole("img", { name: "학교 전체 5명" })).toBeTruthy();
});
