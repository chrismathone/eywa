import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildSampleProgress } from "../sample";
import { DrilldownDial } from "./drilldown-dial";
import { ProgressMapProvider, useProgressMap } from "./map-state";
import { MonthRing } from "./month-ring";
import { ProgressSummary } from "./progress-summary";
import { YearRing } from "./year-ring";

function PeriodActions() {
  const { selectPeriod, resetFocus } = useProgressMap();
  return <>
    <button onClick={() => selectPeriod(2029, 2)}>2029년 2월 바로가기</button>
    <button onClick={resetFocus}>기준일로</button>
  </>;
}

function renderFullMap() {
  return render(
    <ProgressMapProvider progress={buildSampleProgress()}>
      <svg><YearRing /><MonthRing /></svg>
      <ProgressSummary />
      <PeriodActions />
    </ProgressMapProvider>,
  );
}

describe("월 선택 시 첫 주 선택", () => {
  it("월과 1주차를 함께 선택하고 주간 요약도 1주차를 보여 준다", () => {
    renderFullMap();
    fireEvent.click(screen.getByRole("button", { name: /^4월 ·/ }));
    expect(screen.getByRole("button", { name: /^4월 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^4월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^4월 2주차 ·/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("4월 1주")).toBeInTheDocument();
  });

  it("첫 주가 일요일 하루뿐이고 수업이 없어도 다음 주로 건너뛰지 않는다", () => {
    renderFullMap();
    fireEvent.click(screen.getByRole("button", { name: /^2월 ·/ }));
    expect(screen.getByRole("button", { name: /^2월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^2월 2주차 ·/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("2월 1주")).toBeInTheDocument();
  });

  it("이번 달 선택은 1주차로 가고 기준일로 돌아가면 원래 주가 선택된다", () => {
    renderFullMap();
    expect(screen.getByRole("button", { name: /^9월 3주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^9월 ·/ }));
    expect(screen.getByRole("button", { name: /^9월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "기준일로" }));
    expect(screen.getByRole("button", { name: /^9월 3주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("9월 3주")).toBeInTheDocument();
  });

  it("다른 연도의 월 바로가기도 첫 주를 선택한다", () => {
    renderFullMap();
    fireEvent.click(screen.getByRole("button", { name: "2029년 2월 바로가기" }));
    expect(screen.getByRole("button", { name: /^2월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("2월 1주")).toBeInTheDocument();
    expect(screen.getByText("2029년 예상 진도")).toBeInTheDocument();
  });

  it("단계별 확대에서도 월을 누르면 첫 주가 선택되어 있다", () => {
    render(<ProgressMapProvider progress={buildSampleProgress()}><DrilldownDial /></ProgressMapProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^2분기 ·/ }));
    fireEvent.click(screen.getByRole("button", { name: /^4월 ·/ }));
    expect(screen.getByRole("button", { name: /^4월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^4월 2주차 ·/ })).toHaveAttribute("aria-pressed", "false");
  });
});
