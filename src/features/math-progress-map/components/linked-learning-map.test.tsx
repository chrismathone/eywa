import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { LinkedLearningMap } from "./linked-learning-map";
import { learningMapFixture } from "../learning-map.test-fixture";
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
afterEach(cleanup);

describe("진도맵 ↔ 프로그레스바 상호 선택", () => {
  it("세 지도에서 비수업 요일은 숨기고 보고서 없는 수업일도 남긴다", () => {
    const f = learningMapFixture();
    const { container } = render(<LinkedLearningMap {...f} initialQuery="date=2026-09-17&view=day&display=full" />);
    for (const name of ["연간 지도", "연속 지도", "단계별 지도"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const labels = [...container.querySelectorAll('svg path[aria-label]')].map(node => node.getAttribute("aria-label")!);
      expect(labels.some(label => label.startsWith("9/15 (화)"))).toBe(false);
      expect(labels.some(label => label.startsWith("9/17 (목)") && label.includes("수업일 · 진도 기록 없음"))).toBe(true);
      expect(screen.getByRole("region", { name: "진도 목록" })).toHaveTextContent("수업일 · 진도 기록 없음");
      expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%59 / 155차시");
    }
  });
  it("세 지도에서 평일 보강을 날짜순으로 끼워 넣고 MCS 진도를 중복 가산하지 않는다", () => {
    const f = learningMapFixture();
    const records = [...f.records, { date: "2026-09-16", progress: "보강 · 오답 정리", textbook: "교재" }];
    const { container } = render(<LinkedLearningMap {...f} records={records} initialQuery="date=2026-09-17&view=day&display=full" />);
    for (const name of ["연간 지도", "연속 지도", "단계별 지도"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      const days = [...container.querySelectorAll('[data-dial-layer="focus"] path[aria-label]')];
      expect(days.map(day => day.getAttribute("aria-label")!.split(" · ")[0])).toEqual(["9/14 (월)", "9/16 (수)", "9/17 (목)"]);
      fireEvent.click(days[1]);
      expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-09-16");
      expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%59 / 155차시");
      expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", String(f.progress.current));
    }
  });
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
    expect(screen.getByRole("progressbar", { name: "현재진도" })).toHaveAttribute("aria-valuenow", String(f.progress.current));
  });
  it("기간 선택·뒤로 가기·URL 복원에서도 같은 차시가 강조된다", () => {
    const f = learningMapFixture();
    const query = "date=2026-08-27&view=day&lesson=59";
    const { container } = render(<LinkedLearningMap {...f} initialQuery={query} />);
    expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "연간" }));
    const dial = screen.getByRole("group", { name: /학습 진도맵 — 2026년 ·/ });
    fireEvent.keyDown(within(dial).getAllByRole("button")[0], { key: "Enter" });
    expect(screen.getByRole("button", { name: "분기" })).toHaveAttribute("aria-pressed", "true");
    act(() => {
      window.history.replaceState(null, "", `/mcs/progress-map?${query}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
  });
  it("세 지도·월별 타임라인·하단 패널을 모두 복원하고 모드 전환 시 날짜와 차시를 유지한다", () => {
    const f = learningMapFixture();
    const { container } = render(<LinkedLearningMap {...f} initialQuery="date=2026-08-27&view=day&lesson=59" />);
    expect(screen.getByRole("region", { name: "계획 대비 실제" })).toHaveTextContent("62차시");
    expect(screen.getByRole("region", { name: "입학부터 종강까지" })).toHaveTextContent("지금 학습");
    for (const name of ["연간 지도", "연속 지도", "단계별 지도"]) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
      expect(container.querySelector('[data-lesson="직각삼각형의 합동"]')).toHaveAttribute("data-selected", "true");
      expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%59 / 155차시");
      if (name !== "단계별 지도") expect(container.querySelector('[data-learning-center]')).toHaveTextContent("MCS 전체 목표38%59 / 155차시");
      expect(screen.getByRole("region", { name: "진도 목록" })).toBeInTheDocument();
      expect(container.textContent).not.toMatch(/p\.\d|\d쪽|\d일 느림/);
    }
  });
  it("연속 지도 이동과 URL 복원이 같은 월·타임라인을 가리킨다", () => {
    const f = learningMapFixture();
    const { container } = render(<LinkedLearningMap {...f} initialQuery="date=2026-08-27&view=month&display=continuous" />);
    const slider = screen.getByRole("slider", { name: "연속 지도 월 선택" });
    fireEvent.change(slider, { target: { value: 2027 * 12 } });
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2027-01-01");
    expect(container.querySelector('[data-continuous-period]')).toHaveAttribute("data-continuous-period", "2027-01");
    expect(screen.getByLabelText("전체 진도율")).toHaveTextContent("38%");
    act(() => {
      window.history.replaceState(null, "", "/mcs/progress-map?date=2026-08-27&view=day&display=full&topic=" + encodeURIComponent("중2:직각삼각형의 합동"));
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(screen.getByRole("button", { name: "연간 지도" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("진도맵 날짜")).toHaveValue("2026-08-27");
    expect(screen.getByLabelText("선택한 진도 상세")).toHaveTextContent("직각삼각형의 합동");
  });
});
