import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LearningReportList } from "./learning-report-list";
import { learningMapFixture } from "../learning-map.test-fixture";
afterEach(cleanup);

describe("발송 보고서의 전체 건수와 선택 기간", () => {
  it("미래 기간 0건을 전체 보고서 없음으로 표시하지 않고 과거 기록을 최신순으로 연다", () => {
    const records = learningMapFixture().records;
    const select = vi.fn();
    const { container } = render(<LearningReportList records={records} grade="중2" period={{ from: "2026-10-01", to: "2026-10-31", label: "10월" }} onSelect={select} open />);
    expect(screen.getByText("발송 수업보고서 전체 3건")).toBeVisible();
    expect(screen.getByRole("button", { name: "선택 기간 0건" })).toBeVisible();
    expect(screen.queryByText("기준일까지 이 반에서 발송된 수업보고서가 없습니다.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "전체 3건 보기" }));
    expect([...container.querySelectorAll("article time")].map(item => item.textContent)).toEqual(["2026-09-14", "2026-08-27", "2026-07-02"]);
    fireEvent.click(screen.getByRole("button", { name: "2026-08-27" }));
    expect(select).toHaveBeenCalledWith(records[1]);
    expect(records[0].date).toBe("2026-07-02");
  });
  it("기간 양 끝의 기록과 기존 시험 결과·과제를 보존한다", () => {
    render(<LearningReportList records={learningMapFixture().records} period={{ from: "2026-08-27", to: "2026-09-14", label: "선택 기간" }}
      scores={{ "2026-09-14": { dailyTest: "18/20", checkTest: null, examInfo: "일일 18/20" } }} open />);
    expect(screen.getByRole("button", { name: "선택 기간 2건" })).toBeVisible();
    expect(screen.getByText("일일 18/20")).toBeVisible();
    expect(screen.getByText("과제: 오답 정리")).toBeVisible();
    expect(screen.queryByText("2026-07-02")).not.toBeInTheDocument();
  });
  it("실제 빈 기록과 기간 미선택을 구분한다", () => {
    const { rerender } = render(<LearningReportList records={[]} open />);
    expect(screen.getByText("기준일까지 이 반에서 발송된 수업보고서가 없습니다.")).toBeVisible();
    rerender(<LearningReportList records={learningMapFixture().records} open />);
    expect(screen.getByText("2026-07-02")).toBeVisible();
    expect(screen.queryByRole("button", { name: /선택 기간/ })).not.toBeInTheDocument();
  });
});
