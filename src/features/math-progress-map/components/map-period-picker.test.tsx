import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildSampleProgress } from "../sample";
import { DayRing } from "./day-ring";
import { MapPeriodPicker } from "./map-period-picker";
import { ProgressMapProvider, useProgressMap } from "./map-state";
import { MonthRing } from "./month-ring";
import { YearRing } from "./year-ring";

function FutureMonth() {
  const { selectPeriod } = useProgressMap();
  return <button onClick={() => selectPeriod(2029, 2)}>2029년 2월</button>;
}

function setup() {
  render(
    <ProgressMapProvider progress={buildSampleProgress()}>
      <MapPeriodPicker />
      <svg role="group" aria-label="원형 지도"><YearRing /><MonthRing /><DayRing /></svg>
      <FutureMonth />
    </ProgressMapProvider>,
  );
  const picker = within(screen.getByRole("group", { name: "지도 주차·날짜 선택" }));
  return {
    picker,
    week: () => picker.getByRole("combobox", { name: /월 주차 선택$/ }),
    day: () => picker.getByRole("combobox", { name: /날짜 선택$/ }),
    map: within(screen.getByRole("group", { name: "원형 지도" })),
  };
}

describe("툴바 주차·날짜 선택", () => {
  it("하루짜리 첫 주로 다시 이동하고 수업 없는 일요일도 선택한다", () => {
    const { map, week, day } = setup();
    fireEvent.click(map.getByRole("button", { name: /^3월 ·/ }));
    fireEvent.change(week(), { target: { value: "2" } });
    fireEvent.change(week(), { target: { value: "1" } });
    expect(map.getByRole("button", { name: /^3월 1주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(day()).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(day(), { target: { value: "2026-03-01" } });
    expect(map.getByRole("button", { name: /^3\/1 \(일\) ·/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("지도에서 고른 날짜를 표시하고 주가 바뀌면 날짜 선택을 비운다", () => {
    const { map, week, day } = setup();
    fireEvent.click(map.getByRole("button", { name: /^3월 2주차 ·/ }));
    expect(week()).toHaveValue("2");
    fireEvent.click(map.getByRole("button", { name: /^3\/2 \(월\) ·/ }));
    expect(day()).toHaveValue("2026-03-02");
    fireEvent.change(week(), { target: { value: "3" } });
    expect(day()).toHaveValue("");
    expect(within(day()).queryByRole("option", { name: "3/2 (월)" })).not.toBeInTheDocument();
  });

  it("하루짜리 마지막 6주차도 빠짐없이 선택한다", () => {
    const { map, week, day } = setup();
    fireEvent.click(map.getByRole("button", { name: /^8월 ·/ }));
    fireEvent.change(week(), { target: { value: "6" } });
    fireEvent.change(day(), { target: { value: "2026-08-31" } });
    expect(map.getByRole("button", { name: /^8월 6주차 ·/ })).toHaveAttribute("aria-pressed", "true");
    expect(map.getByRole("button", { name: /^8\/31 \(월\) ·/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("연도를 바꾸면 그 해의 요일과 날짜로 갱신한다", () => {
    const { map, day } = setup();
    fireEvent.click(screen.getByRole("button", { name: "2029년 2월" }));
    expect(day()).toHaveAccessibleName("2029년 2월 1주차 날짜 선택");
    expect(within(day()).getAllByRole("option")).toHaveLength(5);
    fireEvent.change(day(), { target: { value: "2029-02-01" } });
    expect(map.getByRole("button", { name: /^2\/1 \(목\) ·/ })).toHaveAttribute("aria-pressed", "true");
  });
});
