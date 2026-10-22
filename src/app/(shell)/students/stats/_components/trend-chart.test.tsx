import { cloneElement, type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// 배치만 고정하고 실제 Recharts의 축·막대·점·ReferenceLine을 함께 렌더해 칸 좌표의 회귀를 잡는다.
vi.mock("recharts", async (original) => ({
  ...await original<Record<string, unknown>>(),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) => cloneElement(children, { width: 1100, height: 300 }),
}));
import { TrendChartImpl } from "./trend-chart-impl";
import { ValueBox } from "./trend-chart-parts";

afterEach(cleanup);
const labels = ["3월", "4월", "3월", "4월"];
const series = [{ key: "paid", name: "수납액", color: "blue", values: [10, 20, 30, 40] }];
const markers = [{ index: 2, before: "청구 기준 추정", after: "메이크에듀 재원생 기록" }];

it("해마다 같은 축 글자가 있어도 세로선은 지정한 두 번째 3월 점에 선다", () => {
  const { container } = render(<TrendChartImpl labels={labels} series={series} kind="line" markers={markers} />);
  const dots = container.querySelectorAll(".recharts-line-dots circle");
  const boundary = container.querySelector(".recharts-reference-line-line");
  expect(dots).toHaveLength(4);
  expect(boundary).toHaveAttribute("x1", dots[2]!.getAttribute("cx"));
  expect(boundary!.getAttribute("x1")).not.toBe(dots[0]!.getAttribute("cx"));
  expect([...container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value")].map((x) => x.textContent)).toEqual(labels);
});

it("막대 경계는 해당 칸의 시작에 서고, 표식 없는 공용 차트는 종전 축 글자 그대로", () => {
  const { container, rerender } = render(<TrendChartImpl labels={labels} series={series} kind="bar" markers={markers} />);
  const ticks = container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value");
  const previous = Number(ticks[1]!.getAttribute("x"));
  const current = Number(ticks[2]!.getAttribute("x"));
  expect(Number(container.querySelector(".recharts-reference-line-line")!.getAttribute("x1"))).toBeCloseTo((previous + current) / 2);
  rerender(<TrendChartImpl labels={labels} series={series} kind="bar" format={(n) => `${n}만원`} />);
  expect(container.querySelector(".recharts-reference-line-line")).toBeNull();
  expect([...container.querySelectorAll(".recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value")].map((x) => x.textContent)).toEqual(labels);
});

it("꺾은선 이름은 기본이 선 끝, labelsBelow면 선 끝 대신 그래프 아래 범례", () => {
  const two = [series[0]!, { key: "due", name: "청구액", color: "red", values: [5, 6, 7, 8], dashed: true }];
  const { container, rerender } = render(<TrendChartImpl labels={labels} series={two} kind="line" legend />);
  expect(screen.getByText("수납액 40명")).toBeInTheDocument();
  expect(container.querySelector("ul")).toBeNull();
  rerender(<TrendChartImpl labels={labels} series={two} kind="line" legend labelsBelow />);
  expect(screen.queryByText("수납액 40명")).toBeNull();
  expect([...container.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["수납액", "청구액"]);
  // 칩이 범례인 카드(legend 꺼짐)는 아래 범례를 따로 세우지 않는다.
  rerender(<TrendChartImpl labels={labels} series={two} kind="line" labelsBelow />);
  expect(container.querySelector("ul")).toBeNull();
});

it("툴팁은 칸 번호 대신 긴 날짜와 기존 값 형식을 표시한다", () => {
  render(<ValueBox active payload={[{ dataKey: "paid", value: 30, payload: { key: "2", tip: "2026년 3월" } }]} series={series} showOf={() => (n) => `${n}만원`} />);
  expect(screen.getByText("2026년 3월")).toBeInTheDocument();
  expect(screen.getByText("30만원")).toBeInTheDocument();
  expect(screen.queryByText("2")).toBeNull();
});

it("최근 12개월의 첫 경계가 왼쪽에 가까워도 긴 앞뒤 기준 문구는 서로 다른 줄로 선다", () => {
  const labels = Array.from({ length: 12 }, (_, i) => `${i + 1}월`);
  const { container } = render(<TrendChartImpl labels={labels} series={[{ ...series[0]!, values: labels.map(() => 10) }]} kind="bar"
    markers={[{ index: 1, before: "지난 기록 · 퇴원은 청구 기준 추정", after: "에이와 기록" }]} />);
  const before = screen.getByText("← 지난 기록 · 퇴원은 청구 기준 추정");
  const after = screen.getByText("에이와 기록 →");
  expect(Number(after.getAttribute("y"))).toBeGreaterThan(Number(before.getAttribute("y")));
  expect(Number(after.getAttribute("y"))).toBeLessThan(Number(container.querySelector(".recharts-reference-line-line")!.getAttribute("y1")));
});
