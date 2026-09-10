import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import {
  render,
  fireEvent,
  screen,
  within,
  cleanup,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  Columns,
  Donut,
  AttendanceHistory,
  COLORS,
  chartMoney,
} from "./charts";

describe("overview chart integrity", () => {
  it("표시 금액은 억·만 단위로 읽히고 툴팁과 표의 원 단위 금액은 보존한다", () => {
    expect(chartMoney(200_000_000)).toBe("2억");
    expect(chartMoney(100_000_000)).toBe("1억");
    expect(chartMoney(50_000_000)).toBe("5,000만");
    expect(chartMoney(-150_000_000)).toBe("-1.5억");
    expect(chartMoney(0)).toBe("0원");
    const html = renderToStaticMarkup(
      <Columns
        labels={["4월"]}
        series={[{ name: "수납", color: COLORS[0], values: [167_620_000] }]}
        unit="원"
        format={chartMoney}
      />,
    );
    expect(html).toContain("1.68억");
    expect(html).toContain("2억");
    expect(html).toContain("1억");
    expect(html).toContain("4월 수납: 167,620,000원");
    const view = render(
      <Columns
        labels={["4월"]}
        series={[{ name: "수납", color: COLORS[0], values: [167_620_000] }]}
        unit="원"
        format={chartMoney}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "수납 수치 자세히 보기" }),
    );
    const popup = screen.getByRole("dialog");
    expect(
      within(popup).getByRole("cell", { name: "167,620,000" }),
    ).toBeTruthy();
    expect(view.container.contains(popup)).toBe(false);
    cleanup();
  });
  it("hydrates all SVG titles without replacing the server-rendered charts", async () => {
    const charts = (
      <div>
        <Donut label="재원" data={[{ label: "초등", value: 184 }]} />
        <Columns
          labels={["9월"]}
          series={[{ name: "수납", color: COLORS[0], values: [12961] }]}
          unit="만원"
        />
        <AttendanceHistory
          points={[{ date: "2026-09-10", rate: 92.4, total: 327 }]}
        />
      </div>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(charts);
    document.body.append(container);
    const firstCircle = container.querySelector("circle");
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, charts, { onRecoverableError });
      });
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(container.querySelector("circle")).toBe(firstCircle);
      expect(container.querySelector("circle title")?.textContent).toBe(
        "초등: 184명 (100.0%)",
      );
    } finally {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    }
  });
  it("keeps donut legend colors aligned when the first category is zero", () => {
    const html = renderToStaticMarkup(
      <Donut
        label="재원"
        data={[
          { label: "빈 분류", value: 0 },
          { label: "학생", value: 7 },
        ]}
      />,
    );
    expect(html).toContain(`stroke="${COLORS[1]}"`);
    expect(html).not.toContain(`stroke="${COLORS[0]}"`);
    expect(html).toContain("재원 7명");
    expect(html).not.toContain("NaN");
  });
  it("renders negative amounts around a zero baseline without negative SVG heights", () => {
    const html = renderToStaticMarkup(
      <Columns
        labels={["8월", "9월"]}
        series={[{ name: "수납", color: COLORS[0], values: [-1000, 4000] }]}
        unit="원"
      />,
    );
    expect(html).not.toMatch(/height="-/);
    expect(html).toContain("-1,000");
    expect(html).toContain("4,000");
  });
  it("distinguishes zero attendance from days with no records", () => {
    const html = renderToStaticMarkup(
      <AttendanceHistory
        points={[
          { date: "2026-09-09", rate: 0, total: 3 },
          { date: "2026-09-10", rate: null, total: 0 },
        ]}
      />,
    );
    expect(html).toContain("0.0%");
    expect(html).not.toContain("NaN");
    render(
      <AttendanceHistory
        points={[
          { date: "2026-09-09", rate: 0, total: 3 },
          { date: "2026-09-10", rate: null, total: 0 },
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "최근 14일 등원율 자세히 보기" }),
    );
    const popup = screen.getByRole("dialog");
    expect(within(popup).getByText("26.09.10 (목)")).toBeTruthy();
    expect(within(popup).getByText("기록 없음")).toBeTruthy();
    expect(within(popup).getByText("0.0%")).toBeTruthy();
    cleanup();
  });
});
