import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { monthPosition } from "../continuous-timeline";
import { buildSampleProgress } from "../sample";
import { ContinuousDial } from "./continuous-dial";
import { MapPeriodPicker } from "./map-period-picker";
import { ProgressMapProvider } from "./map-state";

function setup() {
  const rendered = render(<ProgressMapProvider progress={buildSampleProgress()}><ContinuousDial /><MapPeriodPicker /></ProgressMapProvider>);
  return { ...rendered, dial: within(screen.getByRole("group", { name: "김민준 연속 회전 진도맵" })) };
}

describe("연속 회전 지도", () => {
  it("앞뒤 연도의 달을 함께 보여주고 연말을 양방향으로 이어 간다", () => {
    const { container, dial } = setup();
    fireEvent.click(dial.getByRole("button", { name: /^2026년 12월 ·/ }));
    expect(dial.getByRole("button", { name: /^2027년 1월 ·/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "연속 회전 월 선택" }), { target: { value: monthPosition(2027, 1) } });
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2027-01");
    expect(screen.getByRole("combobox", { name: "2027년 1월 주차 선택" })).toHaveValue("1");
    fireEvent.change(screen.getByRole("slider", { name: "연속 회전 월 선택" }), { target: { value: monthPosition(2026, 12) } });
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2026-12");
  });

  it("데이터가 없는 해를 다른 해의 실적으로 표시하거나 선택하지 않는다", () => {
    const { container, dial } = setup();
    fireEvent.change(screen.getByRole("slider", { name: "연속 회전 월 선택" }), { target: { value: monthPosition(2026, 1) } });
    expect(screen.getByRole("slider", { name: "연속 회전 월 선택" })).toHaveAttribute("min", String(monthPosition(2026, 1)));
    const noData = dial.getByLabelText(/^2025년 12월 ·/);
    expect(noData).not.toHaveAttribute("role", "button");
    fireEvent.click(noData);
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2026-01");
    fireEvent.change(screen.getByRole("slider", { name: "연속 회전 월 선택" }), { target: { value: monthPosition(2029, 2) } });
    expect(screen.getByRole("slider", { name: "연속 회전 월 선택" })).toHaveAttribute("max", String(monthPosition(2029, 2)));
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2029-02");
  });

  it("막대의 연도 정거장을 누르면 실제 시작·종료 또는 중간 연도의 1월로 이동한다", () => {
    const { container } = setup();
    const stops = within(screen.getByRole("group", { name: "연도 바로가기" }));
    for (const [year, month, period] of [[2027, 1, "2027-01"], [2028, 1, "2028-01"], [2029, 2, "2029-02"], [2026, 1, "2026-01"]] as const) {
      fireEvent.click(stops.getByRole("button", { name: `${year}년 ${month}월로 이동` }));
      expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", period);
      expect(screen.getByRole("slider", { name: "연속 회전 월 선택" })).toHaveValue(String(monthPosition(year, month)));
      expect(screen.getByRole("combobox", { name: `${year}년 ${month}월 주차 선택` })).toHaveValue("1");
    }
  });

  it("미래 월을 키보드로 선택하면 그 해의 날짜로 이동한다", () => {
    const { container, dial } = setup();
    fireEvent.keyDown(dial.getByRole("button", { name: /^2027년 2월 ·/ }), { key: "Enter" });
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2027-02");
    expect(screen.getByRole("combobox", { name: "2027년 2월 1주차 날짜 선택" })).toBeInTheDocument();
  });

  it("다음 해의 주차 칸을 누르면 해당 연도의 주와 날짜로 이동한다", () => {
    const { container, dial } = setup();
    fireEvent.click(dial.getByRole("button", { name: /^2027년 2월 2주차 ·/ }));
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2027-02");
    expect(screen.getByRole("combobox", { name: "2027년 2월 주차 선택" })).toHaveValue("2");
    expect(screen.getByRole("option", { name: "2/8 (월)" })).toBeInTheDocument();
  });
});
