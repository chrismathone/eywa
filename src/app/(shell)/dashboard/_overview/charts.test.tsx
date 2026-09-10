import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { Columns, Donut, AttendanceHistory, COLORS } from "./charts";

describe("overview chart integrity", () => {
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
    expect(html).toContain("기록 없음");
    expect(html).not.toContain("NaN");
  });
});
