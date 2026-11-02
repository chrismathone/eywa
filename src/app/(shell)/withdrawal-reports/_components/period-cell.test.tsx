import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { SubjectPeriodGroup } from "@/features/withdrawal-reports/course-period";
import { PeriodCell } from "./period-cell";

const group: SubjectPeriodGroup = {
  subjectLabel: null, first: "2026-02-19", until: "2026-10-30", duration: "8개월, 11일", gaps: 0,
  classes: [{ className: "중등M 초6 MS2A", startDate: "2026-02-19", endDate: "2026-10-30" }],
  specials: [
    { className: "[특강]중2-2 문제 풀이반", startDate: "2026-07-23", endDate: "2026-08-27" },
    { className: "[특강]중3-2 개념 완성반", startDate: "2026-08-17", endDate: "2026-09-10" },
  ],
};

describe("수강기간 칸의 특강(원장 2026-11-02)", () => {
  afterEach(cleanup);

  it("평소엔 라벨만 — 특강 이름·기간을 적지 않는다", () => {
    render(<PeriodCell groups={[group]} />);
    expect(screen.getByRole("button", { name: "특강 수강 × 2회" })).toBeInTheDocument();
    expect(screen.getByText("중등M 초6 MS2A")).toBeInTheDocument();
    expect(screen.queryByText("[특강]중2-2 문제 풀이반")).not.toBeInTheDocument();
    expect(screen.queryByText("2026-07-23 ~ 2026-08-27")).not.toBeInTheDocument();
  });
  it("누르면 겹판에 특강 이름과 기간", async () => {
    render(<PeriodCell groups={[group]} />);
    fireEvent.click(screen.getByRole("button", { name: "특강 수강 × 2회" }));
    expect(await screen.findByText("[특강]중3-2 개념 완성반")).toBeInTheDocument();
    expect(screen.getByText("2026-07-23 ~ 2026-08-27")).toBeInTheDocument();
  });
  it("마우스를 올려도 겹판이 뜬다", async () => {
    render(<PeriodCell groups={[group]} />);
    const trigger = screen.getByRole("button", { name: "특강 수강 × 2회" });
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    expect(await screen.findByText("[특강]중2-2 문제 풀이반", {}, { timeout: 1500 })).toBeInTheDocument();
  });
  it("마우스를 올린 채 눌러도 겹판이 닫히지 않는다(리뷰)", async () => {
    render(<PeriodCell groups={[group]} />);
    const trigger = screen.getByRole("button", { name: "특강 수강 × 2회" });
    fireEvent.pointerEnter(trigger, { pointerType: "mouse" });
    fireEvent.mouseEnter(trigger);
    fireEvent.mouseMove(trigger);
    await screen.findByText("[특강]중2-2 문제 풀이반", {}, { timeout: 1500 });
    await new Promise(resolve => setTimeout(resolve, 600));
    fireEvent.click(trigger);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.getByText("[특강]중2-2 문제 풀이반")).toBeInTheDocument();
  });
  it("특강이 없으면 라벨도 없다", () => {
    render(<PeriodCell groups={[{ ...group, specials: [] }]} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
