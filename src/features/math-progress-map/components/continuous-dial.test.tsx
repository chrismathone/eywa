import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { monthPosition } from "../continuous-timeline";
import { buildSampleProgress } from "../sample";
import { ContinuousDial } from "./continuous-dial";
import { MapPeriodPicker } from "./map-period-picker";
import { ProgressMapProvider, useProgressMap } from "./map-state";

function YearAction() {
  const { selectYear, setDisplay } = useProgressMap();
  return <><button onClick={() => selectYear(2027)}>2027년 선택</button><button onClick={() => setDisplay("continuous")}>연속 모드</button></>;
}

function setup() {
  const rendered = render(<ProgressMapProvider progress={buildSampleProgress()}><ContinuousDial /><MapPeriodPicker /><YearAction /></ProgressMapProvider>);
  return { ...rendered, dial: within(screen.getByRole("group", { name: "김민준 연속 지도" })) };
}

describe("연속 지도", () => {
  it("월과 연도를 넘는 시간 이동 방향에 맞춰 라벨을 회전한다", () => {
    const { container } = setup();
    fireEvent.click(screen.getByRole("button", { name: "연속 모드" }));
    for (const [year, month, angle] of [[2026, 10, 180], [2026, 9, 0], [2026, 3, -180], [2027, 4, 0], [2026, 10, -180]] as const) {
      fireEvent.change(screen.getByRole("slider", { name: "연속 지도 월 선택" }), { target: { value: monthPosition(year, month) } });
      expect(container.querySelector('[data-dial-layer="labels"]')).toHaveAttribute("data-label-angle", String(angle));
    }
  });
  it("주·월·연도를 차례로 선택하면 해당 단위의 라벨만 켜진다", () => {
    const { container, dial } = setup();
    const active = () => container.querySelector('[data-dial-layer="labels"] [data-active="true"]')?.textContent;
    fireEvent.click(dial.getByRole("button", { name: /^2026년 9월 3주차 ·/ }));
    expect(active()).toBe("주간");
    fireEvent.click(dial.getByRole("button", { name: /^2026년 10월 ·/ }));
    expect(active()).toBe("월간");
    fireEvent.click(screen.getByRole("button", { name: "2027년 선택" }));
    expect(active()).toBe("연간");
  });
  it("앞뒤 연도의 달을 함께 보여주고 연말을 양방향으로 이어 간다", () => {
    const { container, dial } = setup();
    fireEvent.click(dial.getByRole("button", { name: /^2026년 12월 ·/ }));
    expect(dial.getByRole("button", { name: /^2027년 1월 ·/ })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "연속 지도 월 선택" }), { target: { value: monthPosition(2027, 1) } });
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2027-01");
    expect(screen.getByRole("combobox", { name: "2027년 1월 주차 선택" })).toHaveValue("1");
    fireEvent.change(screen.getByRole("slider", { name: "연속 지도 월 선택" }), { target: { value: monthPosition(2026, 12) } });
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2026-12");
  });

  it("데이터가 없는 해를 다른 해의 실적으로 표시하거나 선택하지 않는다", () => {
    const { container, dial } = setup();
    fireEvent.change(screen.getByRole("slider", { name: "연속 지도 월 선택" }), { target: { value: monthPosition(2026, 1) } });
    expect(screen.getByRole("slider", { name: "연속 지도 월 선택" })).toHaveAttribute("min", String(monthPosition(2026, 1)));
    const noData = dial.getByLabelText(/^2025년 12월 ·/);
    expect(noData).not.toHaveAttribute("role", "button");
    fireEvent.click(noData);
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2026-01");
    fireEvent.change(screen.getByRole("slider", { name: "연속 지도 월 선택" }), { target: { value: monthPosition(2029, 2) } });
    expect(screen.getByRole("slider", { name: "연속 지도 월 선택" })).toHaveAttribute("max", String(monthPosition(2029, 2)));
    expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", "2029-02");
  });

  it("막대의 연도 정거장을 누르면 실제 시작·종료 또는 중간 연도의 1월로 이동한다", () => {
    const { container } = setup();
    const stops = within(screen.getByRole("group", { name: "연도 바로가기" }));
    for (const [year, month, period] of [[2027, 1, "2027-01"], [2028, 1, "2028-01"], [2029, 2, "2029-02"], [2026, 1, "2026-01"]] as const) {
      fireEvent.click(stops.getByRole("button", { name: `${year}년 ${month}월로 이동` }));
      expect(container.querySelector("[data-continuous-period]")).toHaveAttribute("data-continuous-period", period);
      expect(screen.getByRole("slider", { name: "연속 지도 월 선택" })).toHaveValue(String(monthPosition(year, month)));
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
