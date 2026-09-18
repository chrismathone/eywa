import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildYearView } from "./derive";
import { courseStartDate, isBeforeCourseStart } from "./course-start";
import { dayAngles } from "./geometry";
import { classDaysOfWeek, weekSessionLayout } from "./session-layout";
import { buildSampleProgress } from "./sample";
import { learningMapFixture } from "./learning-map.test-fixture";
import { LinkedLearningMap } from "./components/linked-learning-map";
import { ProgressMapProvider, useProgressMap } from "./components/map-state";
import { YearRing } from "./components/year-ring";
import { MonthRing } from "./components/month-ring";
import { QuarterRing } from "./components/quarter-ring";
import { WeekRing } from "./components/week-ring";
import { DayRing } from "./components/day-ring";
import { HoverCtx } from "./components/segment";

vi.mock("@/components/embed-link", () => ({ EmbedLink: () => null }));

function sample(start = "2026-07-09") {
  const base = buildSampleProgress();
  return { ...base, dailyProgress: [], yearPlan: [], calendar: { classWeekdays: [1, 4] },
    roadmap: { ...base.roadmap!, enrolledOn: start, steps: [{ id: "course", label: "수업", group: "", startMonth: "2026-07", endMonth: "2026-09", estimated: false, description: "" }] } };
}

describe("첫 등원 이전의 비활성 기간", () => {
  it("등록일만 사용하며 첫 등원 월과 연도 경계를 구분한다", () => {
    expect(courseStartDate(sample())).toBe("2026-07-09");
    expect(courseStartDate({ roadmap: undefined })).toBeNull();
    expect(courseStartDate(sample(""))).toBeNull();
    expect(isBeforeCourseStart("2026-07-09", 2026, 6)).toBe(true);
    expect(isBeforeCourseStart("2026-07-09", 2026, 7)).toBe(false);
    expect(isBeforeCourseStart("2026-07-09", 2025, 12)).toBe(true);
    expect(isBeforeCourseStart(null, 2025, 12)).toBe(false);
  });

  it("첫 등원일 이전은 공휴일 없이 비활성화하고 첫 주는 등원일부터 채운다", () => {
    const view = buildYearView(sample());
    expect(view.months.slice(0, 6).every(month => month.beforeStart)).toBe(true);
    expect(view.quarters.map(quarter => quarter.beforeStart)).toEqual([true, true, false, false]);
    const july = view.months[6];
    expect(july.beforeStart).toBe(false);
    expect(july.weeks[0].inactive).toBe(true);
    expect(july.weeks[1].inactive).toBe(false);
    expect(weekSessionLayout(july.weeks[1]).map(cell => cell.day.date)).toEqual(["2026-07-09"]);
    expect(weekSessionLayout(july.weeks[1])[0].angles[0]).toBe(dayAngles("2026-07-09")[0]);
    const before = view.months.flatMap(month => month.weeks.flatMap(week => week.days)).filter(day => day.date < "2026-07-09");
    expect(before.every(day => day.inactive && !day.holidayName && !day.isClassDay)).toBe(true);
    expect(view.months[7].weeks.flatMap(week => week.days).find(day => day.date === "2026-08-15")?.holidayName).toBeTruthy();
  });

  it("종강 이후에도 공휴일·정기 수업 칸을 표시하지 않는다", () => {
    const october = buildYearView(sample()).months[9];
    expect(october.afterEnd).toBe(true);
    expect(october.weeks.every(week => week.inactive && classDaysOfWeek(week).length === 0)).toBe(true);
    expect(october.weeks.flatMap(week => week.days).every(day => day.holidayName === null)).toBe(true);
  });

  it("첫 등원일 미확인은 과거 전체를 잠그지 않는다", () => {
    const view = buildYearView(sample(""));
    expect(view.months.some(month => month.beforeStart)).toBe(false);
    expect(view.months[0].weeks.flatMap(week => week.days).find(day => day.date === "2026-01-01")?.holidayName).toBeTruthy();
  });

  it("비활성 링은 클릭·키보드·호버 반응이 없고 상태 변경 경로도 막는다", () => {
    const hover = vi.fn();
    function Controls() {
      const { focus, selectDay, selectMonth, selectWeek, selectQuarter } = useProgressMap();
      return <><output>{focus.month}월/{focus.week}주/{focus.day ?? ""}</output>
        <button onClick={() => selectMonth(6)}>이전 월</button><button onClick={() => selectWeek(7, 1)}>이전 주</button>
        <button onClick={() => selectDay("2026-07-08")}>이전 날짜</button><button onClick={() => selectQuarter(1)}>이전 분기</button>
      </>;
    }
    render(<ProgressMapProvider progress={sample()}><HoverCtx.Provider value={hover}>
      <svg role="group" aria-label="시계"><QuarterRing/><YearRing/><MonthRing/><WeekRing/><DayRing/></svg><Controls/>
    </HoverCtx.Provider></ProgressMapProvider>);
    const clock = within(screen.getByRole("group", { name: "시계" }));
    const dead = clock.getByLabelText("5월 · 첫 등원 이전");
    expect(dead).toHaveAttribute("aria-disabled", "true");
    expect(dead.parentElement).toHaveAttribute("opacity", "0.4");
    expect(dead).not.toHaveAttribute("tabindex");
    expect(clock.queryByRole("button", { name: /^5월 ·/ })).toBeNull();
    fireEvent.pointerEnter(dead); fireEvent.click(dead); fireEvent.keyDown(dead, { key: "Enter" });
    expect(hover).not.toHaveBeenCalled();
    fireEvent.click(clock.getByRole("button", { name: /^7월 ·/ }));
    expect(screen.getByRole("status")).toHaveTextContent("7월/2주/");
    for (const name of ["이전 월", "이전 주", "이전 날짜", "이전 분기"]) fireEvent.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("status")).toHaveTextContent("7월/2주/");
    expect(clock.queryByLabelText(/^7\/6 \(월\)/)).toBeNull();
    expect(clock.getAllByRole("button", { name: /^7\/9 \(목\)/ }).length).toBeGreaterThan(0);
  });

  it("MCS 연간·연속 지도와 URL 복원은 시작 경계를 지키고 전체 진도는 유지한다", () => {
    const fixture = learningMapFixture();
    const progress = { ...fixture.progress, history: { ...fixture.progress.history!, enrolledAt: "2026-07-09" } };
    const { container } = render(<LinkedLearningMap {...fixture} progress={progress} initialQuery="date=2026-05-05&view=day&display=full"/>);
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-07-09");
    for (const name of ["연간 지도", "연속 지도"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const dead = container.querySelector('[aria-label="5월 · 첫 등원 이전"], [aria-label="2026년 5월 · 첫 등원 이전"]');
      expect(dead).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(dead!);
      expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-07-09");
      expect(container.querySelector('[data-learning-center]')).toHaveTextContent("38%59 / 155차시");
    }
    fireEvent.change(screen.getByLabelText("진도맵 날짜"), { target: { value: "2026-07-08" } });
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-07-09");
  });
});
