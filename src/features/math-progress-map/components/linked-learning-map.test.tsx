import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LinkedLearningMap } from "./linked-learning-map";
import { learningMapFixture } from "../learning-map.test-fixture";
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
afterEach(cleanup);

describe("진도맵 ↔ 프로그레스바 상호 선택", () => {
  it("현재 점은 마지막 확인 날짜를 열고 기준일 진도율은 고정한다", () => {
    const f = learningMapFixture();
    window.history.replaceState(null, "", "/mcs/progress-map?classId=c&student=s&month=2026-09&embed=1");
    const { container } = render(<LinkedLearningMap {...f} />);
    expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%59 / 155차시");
    fireEvent.click(screen.getByRole("button", { name: "현재 진도 상세" }));
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(screen.getByLabelText("선택한 진도 상세")).toHaveTextContent("수업보고서 확인일 2026-08-27");
    expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
    expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%");
    expect(window.location.search).toContain("embed=1");
    expect(window.location.search).toContain("month=2026-09");
    expect(new URLSearchParams(window.location.search).get("topic")).toBe("중2:직각삼각형의 합동");
    expect(screen.getByRole("link", { name: "MCS로 돌아가기" })).toHaveAttribute("href", expect.stringContaining("student=" + f.student.studentId));
  });
  it("목표는 해당 계획 월·차시를 선택하고 미래 조회로 실제 진행률을 바꾸지 않는다", () => {
    const f = learningMapFixture();
    const { container } = render(<LinkedLearningMap {...f} />);
    fireEvent.click(screen.getByRole("button", { name: "1차 목표" }));
    expect(screen.getByRole("button", { name: "월간" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-11-30");
    expect(container.querySelector('[data-lesson="확률의 계산"]')).toHaveAttribute("data-selected", "true");
    expect(screen.getByLabelText("선택한 진도 상세")).toHaveTextContent("앞으로 학습");
    expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%");
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", "59");
  });
  it("기간 선택·뒤로 가기·URL 복원에서도 같은 차시가 강조된다", () => {
    const f = learningMapFixture();
    const query = "date=2026-08-27&view=day&lesson=59";
    const { container } = render(<LinkedLearningMap {...f} initialQuery={query} />);
    expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "연간" }));
    const dial = screen.getByRole("group", { name: "2026년 차시 진도" });
    fireEvent.keyDown(within(dial).getAllByRole("button")[0], { key: "Enter" });
    expect(screen.getByRole("button", { name: "분기" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      window.history.replaceState(null, "", `/mcs/progress-map?${query}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
  });
});
