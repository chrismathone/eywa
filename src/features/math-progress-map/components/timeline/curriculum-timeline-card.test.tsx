import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildSampleProgress } from "../../sample";
import { monthPosition } from "../../continuous-timeline";
import { ProgressMapProvider, useProgressMap } from "../map-state";
import { CurriculumTimelineCard } from "./curriculum-timeline-card";

// 스크롤 위치 계산과 별개로 지도 선택 → 실제 요약 카드의 펼침·주차 내용을 검증한다.
vi.mock("./use-timeline-scroll-spy", () => ({
  useTimelineScrollSpy: () => ({ layoutRef: { current: null }, navigateMonth: vi.fn(), navigatePosition: vi.fn(), registerMonth: vi.fn(), programmaticScroll: false, scrollEdges: { above: false, below: false } }),
}));

function Actions() {
  const { selectMonth, selectWeek, selectDay, selectPeriod, setMode, setDisplay, syncScrolledPosition } = useProgressMap();
  return <>
    {[1, 2, 3].map((month) => <button key={month} onClick={() => selectMonth(month)}>{month}월 선택</button>)}
    <button onClick={() => selectWeek(2, 3)}>2월 3주 선택</button>
    <button onClick={() => selectDay("2026-02-10")}>2월 10일 선택</button>
    <button onClick={() => selectDay("2026-02-01")}>수업 없는 날짜 선택</button>
    <button onClick={() => selectPeriod(2027, 2)}>내년 2월 선택</button>
    <button onClick={() => setMode("year")}>연간 선택</button>
    <button onClick={() => setDisplay("continuous")}>연속 선택</button>
    <button onClick={() => syncScrolledPosition(monthPosition(2027, 1))}>다음 해까지 스크롤</button>
    <button onClick={() => syncScrolledPosition(monthPosition(2026, 1))}>이전 해까지 스크롤</button>
  </>;
}

function setup() {
  render(<ProgressMapProvider progress={buildSampleProgress()}><Actions /><CurriculumTimelineCard /></ProgressMapProvider>);
}

describe("진도 현황의 선택 단위별 펼침과 스크롤 유지", () => {
  it("1월부터 다른 월로 선택을 바꾸면 그 월이 자동으로 열리고 날짜가 주차에 속한다", () => {
    setup();
    for (const month of [1, 2, 3]) {
      fireEvent.click(screen.getByRole("button", { name: `${month}월 선택` }));
      const detail = screen.getByRole("region", { name: `${month}월 상세 학습 내용` });
      const weeks = within(detail).getAllByRole("region", { name: /주차 학습 내용/ });
      expect(weeks).toHaveLength(month === 3 ? 6 : 5);
      expect(detail.querySelectorAll("h5 button[aria-expanded=false]")).toHaveLength(weeks.length);
      const summary = screen.getByRole("region", { name: "2026년 진도 현황" });
      expect(summary.querySelector("button[aria-expanded=true]")).not.toBeNull();
    }
    const first = screen.getByRole("region", { name: "3월 1주차 학습 내용" });
    expect(first).toHaveTextContent("3/1~3/1");
    expect(first).toHaveTextContent("수업이 없는 주입니다.");
    const second = screen.getByRole("region", { name: "3월 2주차 학습 내용" });
    expect(second).toHaveTextContent("3/2~3/8");
    fireEvent.click(within(second).getByRole("button", { name: /^2주차/ }));
    expect(within(second).getByRole("button", { name: /^3\/3 / })).toBeInTheDocument();
    expect(within(second).queryByRole("button", { name: /^3\/9 / })).not.toBeInTheDocument();
  });

  it("수동으로 접을 수 있고 다른 월·연도를 선택하면 다시 열린다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "2월 선택" }));
    const card = screen.getByRole("region", { name: "2026년 진도 현황" });
    fireEvent.click(card.querySelector("button[aria-expanded=true]")!);
    expect(screen.queryByRole("region", { name: "2월 상세 학습 내용" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "내년 2월 선택" }));
    expect(screen.getByRole("region", { name: "2027년 진도 현황" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "2월 상세 학습 내용" })).toBeInTheDocument();
  });

  it("주간·일간 선택은 해당 주만 열고 선택한 날짜를 표시하며 수동으로 접을 수 있다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "2월 3주 선택" }));
    const detail = screen.getByRole("region", { name: "2월 상세 학습 내용" });
    expect(within(detail).getAllByRole("region", { name: /주차 학습 내용/ })).toHaveLength(5);
    expect(detail.querySelectorAll("h5 button[aria-expanded=true]")).toHaveLength(1);
    expect(detail).toHaveTextContent("2/9~2/15");
    fireEvent.click(screen.getByRole("button", { name: "2월 10일 선택" }));
    expect(within(detail).getByRole("button", { name: /^2\/10 / })).toHaveAttribute("aria-current", "date");
    const week = within(detail).getByRole("button", { name: /^3주차/ });
    expect(week).toHaveAttribute("aria-expanded", "true");
    expect(detail).toHaveTextContent("2/10 (화)");
    fireEvent.click(week);
    expect(week).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(screen.getByRole("button", { name: "2월 10일 선택" }));
    expect(week).toHaveAttribute("aria-expanded", "true");
  });

  it("연간에서는 월을 접고 수동으로 펼친 월의 주차도 기본적으로 접는다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "1월 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "연간 선택" }));
    expect(screen.queryByRole("region", { name: "1월 상세 학습 내용" })).not.toBeInTheDocument();
    const month = screen.getAllByRole("article")[0]!;
    fireEvent.click(month.querySelector("button[aria-expanded=false]")!);
    const detail = screen.getByRole("region", { name: "1월 상세 학습 내용" });
    expect(within(detail).getAllByRole("region", { name: /주차 학습 내용/ })).toHaveLength(5);
    expect(detail.querySelectorAll("h5 button[aria-expanded=false]")).toHaveLength(5);
  });

  it("연속 지도는 입학부터 종강까지 연도와 모든 월을 유지한다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "연속 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "내년 2월 선택" }));
    const card = screen.getByRole("region", { name: "전체 진도 보기" });
    expect(within(card).getAllByRole("article")).toHaveLength(38);
    for (const year of [2026, 2027, 2028, 2029]) expect(within(card).getByRole("region", { name: `${year}년 진도` })).toBeInTheDocument();
    expect(within(within(card).getByRole("region", { name: "2029년 진도" })).getAllByRole("article")).toHaveLength(2);
  });

  it("다른 연도로 스크롤해도 펼친 월·주를 그대로 두고 직접 선택 때만 다시 펼친다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "연속 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "2월 10일 선택" }));
    const detail = screen.getByRole("region", { name: "2월 상세 학습 내용" });
    const week = within(detail).getByRole("button", { name: /^3주차/ });
    for (const name of ["다음 해까지 스크롤", "이전 해까지 스크롤"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByRole("region", { name: "2월 상세 학습 내용" })).toBe(detail);
      expect(week).toHaveAttribute("aria-expanded", "true");
      expect(screen.getAllByRole("region", { name: /월 상세 학습 내용/ })).toHaveLength(1);
    }
    fireEvent.click(screen.getByRole("button", { name: "내년 2월 선택" }));
    expect(screen.getByRole("region", { name: "2월 상세 학습 내용" })).not.toBe(detail);
    expect(screen.getByRole("region", { name: "2월 상세 학습 내용" }).querySelectorAll("h5 button[aria-expanded=false]")).toHaveLength(4);
  });

  it("수업 없는 날짜를 열고 스크롤해도 그 날짜 행을 제거하지 않는다", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "연속 선택" }));
    fireEvent.click(screen.getByRole("button", { name: "수업 없는 날짜 선택" }));
    const day = screen.getByRole("button", { name: /^2\/1 / });
    fireEvent.click(screen.getByRole("button", { name: "다음 해까지 스크롤" }));
    expect(screen.getByRole("button", { name: /^2\/1 / })).toBe(day);
    expect(screen.getByRole("button", { name: /^1주차/ })).toHaveAttribute("aria-expanded", "true");
  });
});
